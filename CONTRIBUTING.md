# Contribuindo

Obrigado por querer ajudar no rhut. Issues e pull requests são bem-vindos.

## Antes de começar

- Para algo grande (um recurso novo, uma mudança de comportamento), abra uma issue antes e conte a ideia. Assim a gente combina o caminho antes de você gastar tempo.
- Para correções pequenas (bug, texto, documentação), pode mandar a pull request direto.

## Como mandar uma mudança

1. Faça um fork do repositório e crie uma branch a partir da `main`.
2. Rode localmente seguindo a seção [Rodando localmente](README.md#rodando-localmente) do README.
3. Antes de abrir a PR, rode `npm run typecheck`.
4. Abra a pull request explicando o que mudou e por quê. Se mexer na interface, coloque um print.

Toda PR passa pelo typecheck automático e pela revisão do mantenedor antes de entrar na `main`.

## Estilo

- O código segue o que já existe ao redor: nomes claros, funções pequenas, comentários só onde o porquê não é óbvio.
- O front não usa framework nem etapa de build: HTML, CSS e módulos JavaScript servidos como estão.
- A interface é em português. Textos sem emojis.

## Licença

Ao contribuir, você concorda que sua contribuição fica sob a [licença MIT](LICENSE) do projeto.
