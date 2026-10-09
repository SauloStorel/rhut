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
- Um momento de movimento por tela: a sala "liga" no carregamento; o aviso do Discord é editado conforme a rolagem.

## Arquivos

- `site/index.html`, `site/styles.css`, `site/main.js`: site de divulgação.
- `site/assets/`: fonte, imagens; símbolo, logotipo e laços estão inline no `index.html` como `<symbol>`, vetorizados do material original.
