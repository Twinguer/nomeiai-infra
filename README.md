# Nomeia Aí — infraestrutura HML e PRD

Este repositório versiona a infraestrutura dos dois ambientes. O código da aplicação, Edge Functions e migrações tem fonte única em [nomeiai-app](https://github.com/Twinguer/nomeiai-app). Grafana e Zabbix ficam em [monitor](https://github.com/Twinguer/monitor).

## Organização

- `hml/`: Compose do frontend e do Supabase HML, arquivos auxiliares de Envoy/PostgreSQL/Supavisor e `.env.example` sem valores.
- `prd/vps/`: Compose do frontend PRD e Caddyfile publicados na VPS.
- `prd/local/`: Compose e snapshot dos arquivos auxiliares do Supabase PRD no servidor local.
- `wireguard/`: exemplos de configuração sem chaves privadas.
- `docs/INVENTARIO-HML-PRD.md`: caminhos ativos, serviços e estado da fonte.
- `docs/DEPLOY-HML-PRD.md`: build, publicação, verificação e rollback.
- `docs/ARQUITETURA-PRD.md`: inspeção histórica da PRD antes da passagem do frontend para imagem por SHA.

Não há `.env` operacional, chaves, certificados, dados de PostgreSQL ou Storage neste repositório. Os Compose são cópias das configurações dos hosts e **não** devem ser iniciados diretamente a partir deste checkout. A fonte canônica das Edge Functions é `nomeiai-app/supabase/functions`; o diretório `prd/local/volumes/functions` é um snapshot legado da implantação.

O frontend HML usa banco e API HML. O frontend PRD na VPS usa API e banco PRD no servidor local através da VPN. O mesmo SHA de código é construído separadamente para cada ambiente com as respectivas variáveis.
