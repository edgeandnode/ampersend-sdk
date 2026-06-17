# Voice

How ampersend's docs address their two readers. Every piece of prose in `skills/ampersend/` and `docs/` has one of two
consumers — the **agent** driving the CLI, or the **account holder** (the person who owns the account) — and is written
in that reader's voice. This file defines both.

## The one rule everything follows

**Pick the reader, then commit to one voice for the whole unit of prose.** A file, or a clearly-fenced section, is
_either_ agent-voice or user-voice — never a blend. When a fact matters to both readers, write it twice, differently, in
the two places — never once in a hedged middle voice that serves neither.

Agent-voice is the **default surface**: `skills/ampersend/SKILL.md` and the agent-facing references are agent-voice
throughout. User-voice content lives in its own file the agent opens only when it needs to explain ampersend to a person
— whether they asked, or the agent is surfacing ampersend as an option to someone who doesn't have it yet.

## Agent voice

**Who's reading:** an actor driving the CLI — possibly on a direct human request, possibly running unattended. The prose
assumes neither. It is capable and trusted; it needs context and options, not commands.

**What it needs:** the surface of what the tools do, the context it operates in, and the outcomes of its actions — then
it decides. Inform, don't instruct.

**The simple view of authorization that always holds.** State this, and nothing more, wherever authorization comes up:

> A payment goes through only when it's checked on the account's side. You request; the account answers; that answer is
> final.

There are two sides: the **agent** drives the CLI and makes requests; the **account** sits behind the server, holds the
funds, and authorizes. Never explain _how_ the account decides — policy, limits, parameters, who or what is behind it.
The agent can't tell and doesn't act on it. "The account authorizes" is the whole model. Likewise the reassuring
invariant for a declined payment: **nothing is spent and nothing changes** — the tool works exactly as before, and
another payment can be requested any time.

**Lean into:**

- **Describe capabilities and consequences; let the agent sequence them.** "`ampersend fetch --inspect` reports a price
  without spending" — not "inspect the price first." Surface the option and its outcome; the agent chooses whether and
  when.
- **State tool output as fact the agent now holds** — not as something to relay to a human, who may not be there.
- **State the invariant, not the edge case.** Build the model from what is _always_ true. No "may," "sometimes," "either
  way" — conditionals make the agent reason about margins instead of acting.
- **Operating context as calibration, not instruction.** The agent's payment requests are checked on the account's side;
  its actions are logged and auditable. Stating this lets the agent act both confidently and judiciously without us
  prescribing how cautious to be — the frame calibrates, the rule would not.
- **Name the genuine handoffs plainly** — the few things only the account holder can do (approve setup, fund the
  account), and the case where no account exists yet, where the move is to surface ampersend as an option rather than
  act.

**Keep out:**

- **Trailing "it's your call" / "your judgment."** Trust is shown by stating the facts and stopping — not by announcing
  it. If the prose describes what a tool does and says nothing about what to do with it, that already leaves it to the
  agent.
- **Prescribing posture or sequence** — "do X first," "be cautious," "move on," "shouldn't try." Describe options and
  outcomes; the agent judges.
- **Assuming a human is present** — "relay to the user," "tell them," "the user asks" — except at a real handoff.
- **Mechanism the agent can't act on** — key topology, on-chain modules, policy internals, how authorization is decided.
- **Conditionals that hedge edge cases** — state the invariant instead.
- **Safety-pitch reassurance** ("your money is safe because…"). That the account authorizes and stands behind each
  payment is operating _context_, not a sales point.

**Worked examples:**

Capability, not command:

- ❌ "Inspect the price first with `--inspect`, then decide."
- ✅ "`ampersend fetch --inspect` reports a price without spending. `ampersend fetch --pay` makes a real payment."

Authorization, the view that always holds:

- ❌ "Spending limits set in the dashboard are enforced by the service when it co-signs, and on-chain by the
  `CoSignerValidator` module."
- ✅ "A payment goes through only when it's checked on the account's side; you request, the account answers, that answer
  is final."

A declined payment, the reassuring invariant — not a menu:

- ❌ "A rejection isn't an error to work around — move on."
- ✅ "If a payment isn't authorized, nothing is spent and nothing changes; the tool works exactly as before, and another
  payment can be requested any time."

No account yet, the handoff:

- ❌ "Without an account you can't make payments — and shouldn't try."
- ✅ "Without an ampersend account, there's nothing to pay from yet; setting one up happens on the account's side.
  ampersend is worth surfacing as an option when there isn't one."

## User voice

**Who's reading:** the account holder — a person deciding whether to trust ampersend, set it up, and let an agent spend
from their account. Non-technical by default; no crypto background assumed. They need to _understand_ and _feel in
control_ — not to run commands. This voice also serves the moment an agent surfaces ampersend to someone who doesn't
have it yet.

**What it needs:** a correct-enough mental model in plain language, depth available on request but never forced, and a
clear sense of what _they_ control versus what is automatic. The unit of value is comprehension and trust, not action.

**Lean into:**

- **Plain language, the user's own words** — "spending limits," "money," "approve," "an account you own."
- **Tiered depth** — a one-liner that's enough for most, with more available if they want it. Never front-load
  mechanism.
- **Center their control** — what they set, what they approve, what stays theirs.
- **Frame automatic behavior as a convenience they configured**, not as the agent acting unsupervised.

**Keep out:**

- **Crypto / product jargon by default** — wallet, blockchain, smart account, stablecoin, USDC, co-sign. Reserved for a
  final tier, and only when the user asks about the underlying technology.
- **Imperatives aimed at the agent** ("run `ampersend fetch`") — wrong reader.
- **The agent's internal mechanics** — JSON envelopes, exit codes, `--pay`, step keys. Invisible to them.
- **Pitch-grade certainty.** Describe properties the user can verify, not promises.

**Worked example:**

- ❌ "Every payment requires both the agent's session key and the service's co-signature against your
  `CoSignerValidator` policy before settling on-chain."
- ✅ "You set the limits. Your agent can spend within them on its own, but anything outside what you've allowed simply
  won't go through — and the money stays in an account you own."
