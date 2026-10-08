// Cadastra (ou atualiza) os comandos do bot no Discord. Rode uma vez: `npm run register`.
const { DISCORD_APPLICATION_ID, DISCORD_BOT_TOKEN } = process.env;

const commands = [{ name: "live", description: "Abre uma sala para compartilhar a tela", type: 1 }];

const response = await fetch(`https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/commands`, {
  method: "PUT",
  headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify(commands),
});

console.log(response.ok ? "Comando /live registrado." : `Falhou (${response.status}): ${await response.text()}`);
process.exitCode = response.ok ? 0 : 1;
