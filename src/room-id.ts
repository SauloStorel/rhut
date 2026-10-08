const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const LENGTH = 10;

export const ROOM_ID_PATTERN = `[a-z0-9]{${LENGTH}}`;

export function newRoomId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(LENGTH)), (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}
