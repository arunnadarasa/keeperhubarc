# @keeperhub/wallet

Agentic wallet for KeeperHub. Auto-pays x402 and MPP 402 responses. Server-side Turnkey custody.

## Install

    npx @keeperhub/wallet add

## First use

    import { paymentSigner } from "@keeperhub/wallet";
    const resp = await fetch(url);
    const paid = await paymentSigner.pay(resp);

See docs.keeperhub.com/ai-tools/agentic-wallet (Phase 36).
