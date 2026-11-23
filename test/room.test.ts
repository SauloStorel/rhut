import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signPass } from "../src/identity";
import { MAX_SCREENS, type Room, type RoomInfo, roomStub } from "../src/room";
import { connect, mockOutbound, newRoomId, openRoom } from "./helpers";

let roomId: string;

beforeEach(async () => {
  mockOutbound();
  roomId = newRoomId();
  await openRoom(roomId);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("entrar na sala", () => {
  it("recusa sala que o bot não abriu (fora do modo de desenvolvimento)", async () => {
    const page = await connect(newRoomId());
    await page.next("room-closed");
  });

  it("recusa sala já encerrada", async () => {
    const closedId = newRoomId();
    await openRoom(closedId, { status: "closed" });
    const page = await connect(closedId);
    await page.next("room-closed");
  });

  it("dá as boas-vindas com o passe do SFU e mostra quem está na sala", async () => {
    const ana = await connect(roomId);
    const welcome = await ana.next("welcome");
    expect(welcome.resumed).toBe(false);
    expect(welcome.sfuPass).toMatch(/^[0-9a-f]{32}\.\d+\./);

    const bia = await connect(roomId);
    await bia.next("welcome");
    expect(await ana.presence()).toHaveLength(2);
  });

  it("passe malformado entra como convidado em vez de dar erro", async () => {
    const page = await connect(roomId, { pass: "lixo.123.%%%não-é-base64%%%" });
    const welcome = await page.next("welcome");
    expect(welcome.you.name).toBe("Convidado");
  });

  it("passe válido entra com o nome guardado no clique do Discord", async () => {
    await roomStub(env, roomId).admit({ id: "123", name: "Bia", avatarUrl: null });
    const page = await connect(roomId, { pass: await signPass(env, roomId, "123") });
    expect((await page.next("welcome")).you.name).toBe("Bia");
  });

  it("ignora mensagens que não são JSON, sem tipo ou grandes demais", async () => {
    const page = await connect(roomId);
    await page.next("welcome");
    page.send("isso não é json");
    page.send({ sem: "tipo" });
    page.send({ type: "reaction", emoji: "👏", lixo: "x".repeat(70 * 1024) });
    page.send({ type: "constructor" });
    expect(await page.nothing("reaction")).toBe(true);

    page.send({ type: "reaction", emoji: "👏" });
    await page.next("reaction");
  });
});

describe("transmitir", () => {
  it("várias pessoas transmitem ao mesmo tempo e a sala vira ao vivo", async () => {
    const ana = await connect(roomId);
    const bia = await connect(roomId);
    await Promise.all([ana.next("welcome"), bia.next("welcome")]);

    ana.send({ type: "share", on: true });
    bia.send({ type: "share", on: true });
    await vi.waitFor(async () => expect((await ana.presence()).filter((person) => person.sharing)).toHaveLength(2));

    const info = await roomStub(env, roomId).info();
    expect(info?.status).toBe("live");
    expect(info?.sharers).toHaveLength(2);
    expect(info?.liveSince).toBeTypeOf("number");
  });

  it(`recusa a ${MAX_SCREENS + 1}ª tela`, async () => {
    const pages = await Promise.all(Array.from({ length: MAX_SCREENS + 1 }, () => connect(roomId)));
    await Promise.all(pages.map((page) => page.next("welcome")));

    for (const page of pages.slice(0, MAX_SCREENS)) {
      page.send({ type: "share", on: true });
      await page.next("presence");
    }
    pages.at(-1)!.send({ type: "share", on: true });
    expect((await pages.at(-1)!.next("share-refused")).message).toContain(`${MAX_SCREENS} telas`);
  });

  it("quem já transmite pode repetir o anúncio (reconexão) sem contar como tela nova", async () => {
    const pages = await Promise.all(Array.from({ length: MAX_SCREENS }, () => connect(roomId)));
    await Promise.all(pages.map((page) => page.next("welcome")));
    for (const page of pages) page.send({ type: "share", on: true });

    pages[0].send({ type: "share", on: true, sfu: { sessionId: "sessao1", tracks: ["video1", "audio1"] } });
    await vi.waitFor(async () => expect((await pages[1].presence()).find((person) => person.sfu)?.sfu.tracks).toEqual(["video1", "audio1"]));
    expect(await pages[0].nothing("share-refused")).toBe(true);
  });

  it("descarta trilhas do SFU fora do formato", async () => {
    const ana = await connect(roomId);
    await ana.next("welcome");
    ana.send({ type: "share", on: true, sfu: { sessionId: "../../apps/outro", tracks: ["x"] } });
    const [me] = await ana.presence();
    expect(me.sharing).toBe(true);
    expect(me.sfu).toBeNull();
  });

  it("parar de transmitir volta a sala para aberta", async () => {
    const ana = await connect(roomId);
    await ana.next("welcome");
    ana.send({ type: "share", on: true });
    await ana.next("presence");
    ana.send({ type: "share", on: false });
    await vi.waitFor(async () => expect((await roomStub(env, roomId).info())?.status).toBe("waiting"));
  });
});

describe("sinais WebRTC", () => {
  it("só quem transmite oferece a própria tela", async () => {
    const ana = await connect(roomId);
    const bia = await connect(roomId);
    const { peerId: anaId } = await ana.next("welcome");
    const { peerId: biaId } = await bia.next("welcome");

    // Bia não está transmitindo: a oferta dela não chega à Ana.
    bia.send({ type: "screen-offer", to: anaId, description: { type: "offer", sdp: "falsa" } });
    expect(await ana.nothing("screen-offer")).toBe(true);

    ana.send({ type: "share", on: true });
    await bia.next("presence");
    ana.send({ type: "screen-offer", to: biaId, description: { type: "offer", sdp: "de verdade" } });
    const offer = await bia.next("screen-offer");
    expect(offer.from).toBe(anaId);
    expect(offer.to).toBeUndefined();
  });

  it("só quem está com a câmera ligada oferece a câmera", async () => {
    const ana = await connect(roomId);
    const bia = await connect(roomId);
    const { peerId: anaId } = await ana.next("welcome");
    await bia.next("welcome");

    bia.send({ type: "cam-offer", to: anaId, description: {} });
    expect(await ana.nothing("cam-offer")).toBe(true);

    bia.send({ type: "camera", on: true });
    await ana.next("presence");
    bia.send({ type: "cam-offer", to: anaId, description: {} });
    await ana.next("cam-offer");
  });

  it("sinal sem destinatário não vai para ninguém", async () => {
    const ana = await connect(roomId);
    const bia = await connect(roomId);
    await Promise.all([ana.next("welcome"), bia.next("welcome")]);
    bia.send({ type: "screen-request" });
    expect(await ana.nothing("screen-request")).toBe(true);
  });
});

describe("reações", () => {
  it("só as da lista, e não mais que uma a cada 300 ms por pessoa", async () => {
    const ana = await connect(roomId);
    const bia = await connect(roomId);
    const { peerId: anaId } = await ana.next("welcome");
    await bia.next("welcome");

    ana.send({ type: "reaction", emoji: "🍕" });
    expect(await bia.nothing("reaction")).toBe(true);

    ana.send({ type: "reaction", emoji: "🔥" });
    ana.send({ type: "reaction", emoji: "🔥" });
    expect(await bia.next("reaction")).toMatchObject({ emoji: "🔥", peerId: anaId });
    expect(await bia.nothing("reaction")).toBe(true);
  });
});

describe("quedas e volta", () => {
  it("quem cai sem querer continua na sala e volta como a mesma pessoa, ainda transmitindo", async () => {
    const ana = await connect(roomId);
    const bia = await connect(roomId);
    const { peerId } = await ana.next("welcome");
    await bia.next("welcome");
    ana.send({ type: "share", on: true });
    await vi.waitFor(async () => expect((await bia.presence()).find((person) => person.peerId === peerId)?.sharing).toBe(true));

    ana.close(4999);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await bia.presence()).find((person) => person.peerId === peerId)?.sharing).toBe(true);

    const back = await connect(roomId, { resume: ana.resume });
    const welcome = await back.next("welcome");
    expect(welcome).toMatchObject({ resumed: true, peerId });
    expect((await bia.presence()).filter((person) => person.peerId === peerId)).toHaveLength(1);
  });

  it("mensagem que chega junto com a queda não faz a pessoa sumir para os outros", async () => {
    const ana = await connect(roomId);
    const bia = await connect(roomId);
    const { peerId } = await ana.next("welcome");
    await bia.next("welcome");

    ana.send({ type: "share", on: true });
    ana.close(4999);
    await vi.waitFor(async () => expect((await bia.presence()).find((person) => person.peerId === peerId)?.sharing).toBe(true));
  });

  it("quem não volta a tempo sai da sala e libera a vaga de tela", async () => {
    const ana = await connect(roomId);
    const bia = await connect(roomId);
    await Promise.all([ana.next("welcome"), bia.next("welcome")]);
    ana.send({ type: "share", on: true });
    await bia.next("presence");
    ana.close(4999);
    await bia.next("presence");

    // Adianta o relógio: o prazo de volta de todo fantasma já passou.
    await runInDurableObject(roomStub(env, roomId), async (_instance: Room, state) => {
      for (const [key, ghost] of await state.storage.list<{ expiresAt: number }>({ prefix: "ghost:" })) {
        await state.storage.put(key, { ...ghost, expiresAt: Date.now() - 1 });
      }
      await state.storage.setAlarm(Date.now());
    });
    await runDurableObjectAlarm(roomStub(env, roomId));

    expect(await bia.presence()).toHaveLength(1);
    await vi.waitFor(async () => expect((await roomStub(env, roomId).info())?.status).toBe("waiting"));
  });

  it("aba fechada (código 1000) sai na hora", async () => {
    const ana = await connect(roomId);
    const bia = await connect(roomId);
    await Promise.all([ana.next("welcome"), bia.next("welcome")]);
    await bia.presence();
    ana.close(1000);
    await vi.waitFor(async () => expect(await bia.presence()).toHaveLength(1));
  });
});

describe("fechar a sala", () => {
  it("só admin ou quem está na sala fecha", async () => {
    expect(await roomStub(env, roomId).requestClose("estranho", false)).toBe(false);
    expect(await roomStub(env, roomId).requestClose("estranho", true)).toBe(true);
  });

  it("avisa quem está lá e apaga do storage tudo menos o estado", async () => {
    await roomStub(env, roomId).admit({ id: "123", name: "Bia", avatarUrl: null });
    const ana = await connect(roomId);
    await ana.next("welcome");

    await roomStub(env, roomId).requestClose("x", true);
    await ana.next("room-closed");

    await vi.waitFor(async () => {
      const keys = await runInDurableObject(roomStub(env, roomId), async (_instance: Room, state) => [...(await state.storage.list()).keys()]);
      expect(keys).toEqual(["info"]);
    });
    expect((await roomStub(env, roomId).info())?.status satisfies RoomInfo["status"] | undefined).toBe("closed");
  });
});
