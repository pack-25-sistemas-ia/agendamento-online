---
name: booking-concurrency
description: Use ao criar ou alterar qualquer operação que grava na agenda (reservar, remarcar, bloquear, mudar disponibilidade).
---

# booking-concurrency

- Conflito é decidido pelo **banco**: exclusão `schedule_entries_no_overlap` (GiST, `where active`) + advisory lock por profissional (`private.ag_lock`) tomado **antes** de validar. Trave dois profissionais em ordem fixa (menor id primeiro) para evitar deadlock.
- Reagendar é uma transação: valida ignorando a própria ocupação, move, registra evento; falha mantém o original.
- Cancelar desativa a ocupação (`active = false`) e libera o horário.
- Gatilhos adiados (`appointment_consistency`, `entry_consistency`, `override_consistency`) são SECURITY DEFINER e **leem o estado atual**, não o `NEW` do evento adiado.
- Armadilhas: `SET CONSTRAINTS ALL IMMEDIATE` persiste na transação (volte a `DEFERRED`); testes SQL com rollback escondem gatilhos adiados — cubra com `scripts/test-concurrency.mjs`.
- Teste: `pnpm test:concurrency` (rode sem outra carga).
