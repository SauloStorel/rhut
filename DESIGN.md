# Design

Registro do mundo visual do rhut, tirado do que foi construído em `site/` e em `public/` (a sala).

## Mundo

- **Preto e off-white.** Preto puro `#000` e off-white `#f4f2ec` alternam por seção; superfícies escuras em `#0b0b0b` e `#161616`. O único vermelho é o do "Ao vivo" (`#f23f43`).
- **Símbolo orgânico.** O laço aberto aparece grande e cortado pela borda, nunca centralizado como ícone. Laços cinzas (`#1b1b1b` no preto, `#e3e0d8` no off-white) vazam dos cantos.
- **Tipo.** Onest, auto-hospedada. Títulos em 750 a 800, entrelinha 0,92 a 1,02, espaçamento -0,04em a -0,06em. Texto em 400, cinza `#a6a39b` no preto e `#57544d` no off-white.
- **Componentes vêm da sala.** Palco com borda fina e raio 14px, barra de controles (dock), selo "Ao vivo", seletor de qualidade, pilha de avatares. Botões com raio 12px: sólido claro no preto, sólido preto no off-white, e versões contorno.

## Regras

- Sem emojis e sem travessões nos textos.
- Sem rótulo pequeno acima de título.
- Dados de exemplo (pessoas, transmissão) sempre com legenda "Interface ilustrativa".
- A réplica do Discord usa as cores do Discord, não as do rhut, incluindo a barra colorida do embed.
- Movimento a serviço do produto: a sala "liga" no carregamento, a galera entra com os avisos do app, o símbolo do topo segue o mouse, seções aparecem presas à rolagem (rápido, sem atrasar a leitura), cartões do Discord inclinam, as letras do "/live" mudam de peso perto do cursor e os botões principais são magnéticos.
- A mini sala em Recursos é interativa de verdade: qualidade, volume até 200%, modo ambiente, tela cheia e câmera (só no navegador de quem clicou).
- Nada depende de animação para ser lido. Com "menos movimento" ligado, tudo fica parado; efeitos de mouse só existem com mouse.

## Arquivos

- `site/index.html`, `site/styles.css`, `site/main.js`: site de divulgação.
- `site/js/`: um módulo por interação (mini sala, presença, parallax, inclinação, letras cinéticas, botões magnéticos, copiar, avisos).
- `site/assets/`: fonte, imagens; símbolo, logotipo e laços estão inline no `index.html` como `<symbol>`, vetorizados do material original.
