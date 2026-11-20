# Deploy e rollback do frontend

O código vem de `Twinguer/nomeiai-app`. Registrar o SHA completo antes do build. Não construir a partir de `/home/razum/repositorio` nem do checkout Windows com alterações locais.

## HML

1. Atualizar `/home/razum/nomeiai-hml-source` para o SHA aprovado, sem alterações locais.
2. Compilar com `bash deploy/build-image.sh hml SHA /home/razum/supabase-nomeia-test/.env.hml-app`.
3. Atualizar a tag em `/home/razum/supabase-nomeia-test/compose-app-test.yaml` e em `hml/compose-app.yaml` neste repositório.
4. Fazer `docker compose --env-file .env.hml-app -f compose-app-test.yaml up -d --no-build nomeia-app-test` no diretório da stack.
5. Verificar HTTP 200 em `http://127.0.0.1:8081/`, destino da API HML, login e rotas afetadas.

## PRD

1. Conferir que HML passou na validação e que o mesmo SHA está em `/opt/nomeiai/source-2357bad` (substituir o nome do diretório em releases futuros).
2. Compilar com `bash deploy/build-image.sh prd SHA /opt/nomeiai/.env.build` usando somente valores públicos de frontend. O arquivo de build tem modo 600 e fica fora do Git.
3. Comparar `index.html` e assets do novo build com o release esperado; guardar a imagem e o Compose anteriores. Para migrações de banco, obter backup e validar plano de aplicação separadamente.
4. Atualizar a tag em `/opt/nomeiai/compose.yaml` e `prd/vps/compose.yaml`; executar `docker compose -f compose.yaml up -d --no-build app` em `/opt/nomeiai`.
5. Conferir o container, `https://nomeiai.com.br/`, `https://api.nomeiai.com.br/` e os fluxos afetados. Registrar SHA de código e commit de infraestrutura.

Rollback do frontend PRD: restaurar o Compose salvo antes do release e executar `docker compose -f compose.yaml up -d --no-build app`. A imagem anterior deve permanecer no host. Rollback de banco exige procedimento e backup próprios; trocar apenas a imagem não desfaz migrações.

Para o release inicial `2357bad`, o Compose anterior da VPS foi salvo como `/opt/nomeiai/compose.before-2357bad.yaml` e a pasta `dist` anterior foi mantida. A imagem antiga permanece disponível para retorno imediato.
