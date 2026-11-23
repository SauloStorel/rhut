import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withGameAudio } from "../public/audio.js";
import { signSfuPass, signSfuSession, verifyPass, verifySession } from "../src/identity";
import type { RoomCard } from "../src/lobby";
import { panel } from "../src/panel";
import { connect, mockOutbound, newRoomId, openRoom } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("identidade", () => {
  it.each(["", "a.b", "123.9999999999.%%%", "123.9999999999.###", "123.1.abc"])("token inválido (%j) vira null, sem erro", async (token) => {
    await expect(verifyPass(env, "sala000001", token)).resolves.toBeNull();
    await expect(verifySession(env, token)).resolves.toBeNull();
  });

  it("cookie de sessão adulterado na página da sala não derruba o Worker", async () => {
    mockOutbound();
    const roomId = newRoomId();
    await openRoom(roomId);
    const response = await SELF.fetch(`http://rhut.test/api/rooms/${roomId}/ws?resume=${crypto.randomUUID()}`, {
      headers: { Upgrade: "websocket", Cookie: "rhut_session=1.2.%E0%A4%A" },
    });
    expect(response.status).toBe(101);
  });
});

describe("configuração da sala", () => {
  it("diz que as telas vão pelo SFU quando ele está configurado", async () => {
    mockOutbound();
    const config = await (await SELF.fetch(`http://rhut.test/api/rooms/${newRoomId()}`)).json<{ sfu: boolean }>();
    expect(config.sfu).toBe(true);
  });
});

describe("proxy do SFU", () => {
  it("só cria sessão quem tem o passe da sala", async () => {
    const roomId = newRoomId();
    const fetchSpy = mockOutbound({ sessionId: "sessao-1" });

    expect((await SELF.fetch(`http://rhut.test/api/rooms/${roomId}/sfu/sessions`, { method: "POST" })).status).toBe(403);
    const otherRoomPass = await signSfuPass(env, newRoomId(), "peer-1");
    expect((await SELF.fetch(`http://rhut.test/api/rooms/${roomId}/sfu/sessions`, { method: "POST", headers: { "X-Sfu-Pass": otherRoomPass } })).status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();

    const response = await SELF.fetch(`http://rhut.test/api/rooms/${roomId}/sfu/sessions`, { method: "POST", headers: { "X-Sfu-Pass": await signSfuPass(env, roomId, "peer-1") } });
    const { sessionId, grant } = await response.json<{ sessionId: string; grant: string }>();
    expect(sessionId).toBe("sessao-1");
    expect(grant.startsWith("sessao-1.")).toBe(true);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("https://rtc.live.cloudflare.com/v1/apps/app-de-teste/sessions/new");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer token-do-sfu");
  });

  it("repassa cada ação para o caminho e o método certos, só na sessão do passe", async () => {
    const roomId = newRoomId();
    const fetchSpy = mockOutbound({ requiresImmediateRenegotiation: false, tracks: [] });
    const headers = { "X-Sfu-Session": await signSfuSession(env, roomId, "sessao-1"), "Content-Type": "application/json" };

    const expected = { tracks: ["POST", "sessions/sessao-1/tracks/new"], renegotiate: ["PUT", "sessions/sessao-1/renegotiate"], close: ["PUT", "sessions/sessao-1/tracks/close"] };
    for (const [action, [method, path]] of Object.entries(expected)) {
      fetchSpy.mockClear();
      const response = await SELF.fetch(`http://rhut.test/api/rooms/${roomId}/sfu/${action}`, { method: "POST", headers, body: JSON.stringify({ tracks: [] }) });
      expect(response.status).toBe(200);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(String(url)).toBe(`https://rtc.live.cloudflare.com/v1/apps/app-de-teste/${path}`);
      expect(init?.method).toBe(method);
    }

    // Passe de outra sala (ou sessão inventada) não mexe em sessão nenhuma.
    fetchSpy.mockClear();
    const forged = { ...headers, "X-Sfu-Session": await signSfuSession(env, newRoomId(), "sessao-1") };
    expect((await SELF.fetch(`http://rhut.test/api/rooms/${roomId}/sfu/close`, { method: "POST", headers: forged, body: "{}" })).status).toBe(403);
    expect((await SELF.fetch(`http://rhut.test/api/rooms/${roomId}/sfu/sessions-new`, { method: "POST", headers, body: "{}" })).status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("o passe do SFU que a sala entrega serve para criar sessão", async () => {
    mockOutbound({ sessionId: "sessao-2" });
    const roomId = newRoomId();
    await openRoom(roomId);
    const page = await connect(roomId);
    const { sfuPass } = await page.next("welcome");
    const response = await SELF.fetch(`http://rhut.test/api/rooms/${roomId}/sfu/sessions`, { method: "POST", headers: { "X-Sfu-Pass": sfuPass } });
    expect(response.status).toBe(200);
  });
});

describe("painel", () => {
  const card = (index: number): RoomCard => ({
    roomId: `sala${String(index).padStart(6, "0")}`,
    guildId: "guild-1",
    status: index % 2 ? "live" : "waiting",
    openerName: `Pessoa ${index}`,
    sharers: index % 2 ? [{ id: `u${index}`, name: `Pessoa ${index}`, avatarUrl: null }] : [],
    liveSince: index % 2 ? 1_700_000_000_000 : null,
    people: 2,
    pageUrl: null,
    voiceChannelId: null,
  });

  it("até 4 salas: uma fileira de botões para cada, mais o Abrir sala", () => {
    const { components } = panel([1, 2, 3, 4].map(card), null, "auto");
    expect(components).toHaveLength(5);
    expect(components.every((row) => row.components.every((component) => component.type === 2))).toBe(true);
  });

  it("mais de 4 salas: 3 com botões e as outras no menu", () => {
    const { components, embeds } = panel([1, 2, 3, 4, 5, 6].map(card), null, "auto");
    expect(components).toHaveLength(5);
    const picker = components[3].components[0] as { type: number; options: { value: string }[] };
    expect(picker.type).toBe(3);
    expect(picker.options.map((option) => option.value)).toEqual(["sala000004", "sala000005", "sala000006"]);
    expect(embeds[0].description.split("\n")).toHaveLength(6);
  });

  it("várias pessoas transmitindo na mesma sala", () => {
    const live = { ...card(1), sharers: [{ id: "a", name: "Ana", avatarUrl: null }, { id: "b", name: "Bia", avatarUrl: null }, { id: "c", name: "C*io", avatarUrl: null }], people: 5 };
    const { embeds } = panel([live], null, "auto");
    expect(embeds[0].description).toContain("**Ana**, **Bia** e **C\\*io** estão transmitindo");
    expect(embeds[0].description).toContain("2 assistindo");
  });
});

describe("som de jogo no SDP", () => {
  const sdp = ["v=0", "m=audio 9 UDP/TLS/RTP/SAVPF 111", "a=rtpmap:111 opus/48000/2", "a=fmtp:111 minptime=10;useinbandfec=1", ""].join("\r\n");

  it("liga estéreo, FEC e bitrate alto, desliga DTX e mantém o que o navegador pôs", () => {
    const line = withGameAudio(sdp).split("\r\n").find((item) => item.startsWith("a=fmtp:111"))!;
    const params = Object.fromEntries(line.replace("a=fmtp:111 ", "").split(";").map((param) => param.split("=")));
    expect(params).toEqual({ minptime: "10", useinbandfec: "1", stereo: "1", "sprop-stereo": "1", maxaveragebitrate: "160000", usedtx: "0" });
  });

  it("aplicar duas vezes não duplica parâmetros", () => {
    expect(withGameAudio(withGameAudio(sdp))).toBe(withGameAudio(sdp));
  });

  it("SDP sem Opus passa intacto", () => {
    const video = "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 VP8/90000\r\n";
    expect(withGameAudio(video)).toBe(video);
  });
});
