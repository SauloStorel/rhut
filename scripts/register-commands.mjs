// Cadastra (ou atualiza) os comandos do bot no Discord. Rode uma vez: `npm run register`.
const { DISCORD_APPLICATION_ID, DISCORD_BOT_TOKEN } = process.env;

const MANAGE_CHANNELS = String(1 << 4);
const GUILD_ONLY = [0];

const commands = [
  { name: "live", description: "Abre uma sala para compartilhar a tela", type: 1 },
  // Só quem pode gerenciar canais escolhe onde o painel fica.
  { name: "painel", description: "Fixa neste canal o painel com as salas abertas e o botão para abrir outra", type: 1, default_member_permissions: MANAGE_CHANNELS, contexts: GUILD_ONLY },
];

const response = await fetch(`https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/commands`, {
  method: "PUT",
  headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify(commands),
});

console.log(response.ok ? "Comandos /live e /painel registrados." : `Falhou (${response.status}): ${await response.text()}`);
process.exitCode = response.ok ? 0 : 1;
