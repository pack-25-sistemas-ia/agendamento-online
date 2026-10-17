---
name: timezone-dst
description: Use ao tocar em fuso horário, conversão de data/hora local, horário de verão ou exibição de horários.
---

# timezone-dst

- Instantes em `timestamptz`/ms UTC; janelas semanais em **hora local da empresa** (`scheduling_settings.timezone`, IANA). Mostre sempre no fuso da empresa e informe o fuso ao cliente.
- Política (D-A5): hora local **inexistente** → desloca para frente; **ambígua** → ocorrência posterior. «24:00» é a meia-noite seguinte.
- TS: `lib/scheduling/time.ts` (só `Intl`, sem biblioteca). SQL: `AT TIME ZONE`. Os dois precisam concordar: valores de teste em America/New_York 14/03/2027 (salto) e 07/11/2027 (volta).
- Nunca use `new Date()`/`Date.now()` direto no código de domínio de componentes; use `nowMs` de `lib/time`.
- Teste: `engine-time.test.ts`, `engine-slots.test.ts`, `55_ag_time_dashboard.sql`.
