# Inventário operacional — 19/11/2026

## Repositórios

| Repositório | Papel | Referência observada |
| --- | --- | --- |
| `Twinguer/nomeiai-app` | Fonte única do frontend, Edge Functions e migrações | `2357badcd1dc304230fd02018e078fdf16fa964a` |
| `Twinguer/nomeiai-infra` | Compose, proxy e configurações de infraestrutura HML/PRD | Este repositório |
| `Twinguer/monitor` | Grafana, Zabbix e coletor de presença | `a022fdd66af7fecce8fba73b9f82b7dd1c0a65a1` |

O checkout antigo de desenvolvimento em Windows (`convoca-ai`) e `/home/razum/repositorio` contêm alterações não incorporadas ao commit de referência. Não usá-los como origem de build de HML ou PRD sem revisão e commit explícitos.

## Ambientes e arquivos ativos

| Serviço | Host e caminho ativo | Arquivo versionado |
| --- | --- | --- |
| Frontend HML | `192.168.0.241`, `/home/razum/supabase-nomeia-test/compose-app-test.yaml`, porta 8081 | `hml/compose-app.yaml` |
| Supabase HML | `192.168.0.241`, `/home/razum/supabase-nomeia-hml/docker-compose.yml`, banco em 127.0.0.1:5544 e API em 192.168.0.241:8010 | `hml/docker-compose.yml` |
| Frontend e Caddy PRD | VPS `177.153.53.78`, `/opt/nomeiai/compose.yaml` e `Caddyfile`, HTTPS 443 | `prd/vps/` |
| Supabase PRD | `192.168.0.241`, `/home/razum/supabase-nomeia-test/docker-compose.yml`, banco/pooler em 127.0.0.1:5432 e API em 8000 | `prd/local/` |
| Monitoramento | Servidor local, stack própria | `Twinguer/monitor` |

A VPS encaminha `api.nomeiai.com.br` pela VPN WireGuard para o gateway PRD local. HML e PRD usam bancos, volumes e credenciais diferentes. O diretório com `test` no nome contém a API PRD; o diretório com `hml` contém a API HML.

## Estado da fonte e do deploy

- O commit `2357bad` foi compilado nos dois hosts com variáveis específicas de cada ambiente. HML serve `nomeiai-app:hml-2357badcd1dc`.
- O build `nomeiai-app:prd-2357badcd1dc` tem `index.html` e os 23 assets ativos idênticos aos da publicação PRD anterior. A versão do Compose em `prd/vps/` fixa essa imagem e dispensa o bind mount de `dist`.
- Os Compose neste repositório são cópias sanitizadas dos arquivos ativos. Segredos, dados, Storage, certificados, chaves WireGuard e arquivos `.env` operacionais ficam fora do Git.
- `prd/local/volumes/functions` registra o snapshot anterior da stack. A fonte canônica para novas Edge Functions é `nomeiai-app/supabase/functions`; conferir e sincronizar a função implantada antes de qualquer deploy.
- O Compose HML foi versionado, mas os arquivos auxiliares HML em `volumes/api`, `volumes/db` e `volumes/pooler` permanecem no servidor, pendentes de auditoria de conteúdo. Não executar o Compose HML a partir deste checkout como se fosse autossuficiente.
