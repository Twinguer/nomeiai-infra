# Nomeia Aí — stack de produção

Retrato dos arquivos ativos em **19/11/2026**. A VPS publica o frontend e encaminha a API por WireGuard ao Supabase/PostgreSQL no servidor local. Leia [a arquitetura e o runbook](docs/ARQUITETURA-PRD.md) antes de qualquer mudança.

## Conteúdo

- `vps/`: Compose e Caddyfile ativos em `/opt/nomeiai`.
- `local/`: Compose de PRD e arquivos montados de Envoy, PostgreSQL, Supavisor e Edge Functions ativos em `/home/razum/supabase-nomeia-test`.
- `wireguard/`: configuração da VPS **sem chave privada** e exemplo inferido para o servidor local.

O nome do diretório local contém “test”, mas o gateway publicado em `10.77.0.2:8000` é o backend usado pelo domínio de produção. HML está em outro Compose e não integra este repositório.

## Limites deste snapshot

Não inclui `.env`, chaves, certificados, banco de dados, objetos do Storage, backups nem o frontend compilado `dist`. O código-fonte do frontend não estava em `/opt/nomeiai`; a imagem de Nginx monta um `dist` externo. Por isso, este repositório **não é um clone autossuficiente** da PRD. A publicação exige segredos fornecidos separadamente, dados restaurados e artefato frontend versionado.

`local/.env.example` enumera as variáveis referenciadas pelo Compose, sem valores operacionais. Não execute `docker compose up` diretamente a partir deste snapshot em um host de produção. Compare configurações, valide segredos e tenha backup e rollback antes de aplicar mudanças.

## Verificação sem alteração

Na VPS: `cd /opt/nomeiai && docker compose ps` e `curl -I https://nomeiai.com.br/`.

No servidor local: `docker compose -f /home/razum/supabase-nomeia-test/docker-compose.yml ps` e `docker exec supabase-db pg_isready -U supabase_admin -d postgres`.

A API de PRD depende da VPN WireGuard entre `10.77.0.1` e `10.77.0.2`. O túnel SSH para administração do banco é separado.
