import { SELF, runInDurableObject } from "cloudflare:test";
import { vi } from "vitest";
import type { Room, RoomInfo } from "../src/room";
import { roomStub } from "../src/room";
import { env } from "cloudflare:workers";

type Message = { type: string; [key: string]: any };

let roomCounter = 0;

// Um id de sala novo por teste (10 letras minúsculas ou números, como os do bot).
export function newRoomId() {
  return `sala${String(++roomCounter).padStart(6, "0")}`;
}

// Simula o Discord e o SFU: toda chamada de fetch para fora responde 200 com `body` e fica registrada.
export function mockOutbound(body: object = { id: "mensagem-1" }) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(body));
}

// Sala aberta pelo bot, como depois do /live (com aviso próprio no canal).
export async function openRoom(roomId: string, changes: Partial<RoomInfo> = {}) {
  const info: RoomInfo = {
    roomId,
    guildId: "guild-1",
    guild: null,
    openerId: "user-1",
    openerName: "Ana",
    channelId: "canal-1",
    board: "channel",
    pageUrl: null,
    voiceChannelId: null,
    messageId: "mensagem-1",
    status: "waiting",
    liveSince: null,
    sharers: [],
    people: 0,
    ...changes,
  };
  await runInDurableObject(roomStub(env, roomId), (_instance: Room, state) => state.storage.put("info", info));
  return info;
}

// Uma página conectada à sala: guarda as mensagens que chegam e espera pela próxima de um tipo.
export async function connect(roomId: string, { resume = crypto.randomUUID(), pass }: { resume?: string; pass?: string } = {}) {
  const url = new URL(`http://rhut.test/api/rooms/${roomId}/ws`);
  url.searchParams.set("resume", resume);
  if (pass) url.searchParams.set("pass", pass);

  const response = await SELF.fetch(url, { headers: { Upgrade: "websocket" } });
  const socket = response.webSocket!;
  const inbox: Message[] = [];
  const waiting: { type: string; resolve: (message: Message) => void }[] = [];
  socket.accept();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data as string);
    const waiter = waiting.find((item) => item.type === message.type);
    if (!waiter) {
      inbox.push(message);
      return;
    }
    waiting.splice(waiting.indexOf(waiter), 1);
    waiter.resolve(message);
  });

  return {
    socket,
    resume,
    send: (message: object | string) => socket.send(typeof message === "string" ? message : JSON.stringify(message)),

    // A próxima mensagem desse tipo (a que já chegou ou a que vai chegar).
    next(type: string, timeoutMs = 2000): Promise<Message> {
      const index = inbox.findIndex((message) => message.type === type);
      if (index >= 0) return Promise.resolve(inbox.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        waiting.push({ type, resolve });
        setTimeout(() => reject(new Error(`Nenhuma mensagem "${type}" em ${timeoutMs} ms`)), timeoutMs);
      });
    },

    // Nenhuma mensagem desse tipo chega no tempo dado.
    async nothing(type: string, waitMs = 300) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return !inbox.some((message) => message.type === type);
    },

    // A última presença recebida até agora (descarta as anteriores).
    async presence() {
      await new Promise((resolve) => setTimeout(resolve, 50));
      let latest = await this.next("presence");
      for (let index = inbox.findIndex((message) => message.type === "presence"); index >= 0; index = inbox.findIndex((message) => message.type === "presence")) {
        latest = inbox.splice(index, 1)[0];
      }
      return latest.people as any[];
    },

    close: (code = 1000) => socket.close(code),
  };
}

export type Page = Awaited<ReturnType<typeof connect>>;
