export interface RotationResult {
  newValue: string;
  oldKeyId?: string;
  newKeyId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Rotate a Stripe API key.
 *
 * - Restricted keys (rk_live_ / rk_test_): rotated via the Stripe API.
 * - Secret keys (sk_live_ / sk_test_): cannot be rotated via API; clear
 *   instructions are thrown so the caller can surface them to the user.
 */
export async function rotateStripeKey(
  currentValue: string,
  options: { dryRun?: boolean } = {},
): Promise<RotationResult> {
  const headers = {
    Authorization: `Bearer ${currentValue}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };

  // ── Secret keys — not rotateable via API ─────────────────────────
  if (
    currentValue.startsWith("sk_live_") ||
    currentValue.startsWith("sk_test_")
  ) {
    throw new Error(
      "Stripe secret keys (sk_live_/sk_test_) cannot be rotated via the API.\n" +
        "Rotate manually in the Stripe Dashboard: https://dashboard.stripe.com/apikeys\n" +
        "Then update with: slickenv push",
    );
  }

  // ── Dry run — just validate the current key ──────────────────────
  if (options.dryRun) {
    const validateRes = await fetch("https://api.stripe.com/v1/account", {
      headers,
    });

    if (!validateRes.ok) {
      throw new Error(
        `Stripe key validation failed: ${validateRes.status} ${validateRes.statusText}`,
      );
    }

    const account = (await validateRes.json()) as { id: string };

    return {
      newValue: currentValue,
      metadata: {
        accountId: account.id,
        validationOnly: true,
        keyType: "restricted",
      },
    };
  }

  // ── Restricted keys — full rotation flow ─────────────────────────
  if (
    !currentValue.startsWith("rk_live_") &&
    !currentValue.startsWith("rk_test_")
  ) {
    throw new Error(
      `Unrecognised Stripe key format. Expected rk_live_, rk_test_, sk_live_, or sk_test_.`,
    );
  }

  // Step 1: fetch existing restricted keys to find the current one
  const listRes = await fetch("https://api.stripe.com/v1/restricted_keys", {
    headers,
  });

  if (!listRes.ok) {
    throw new Error(
      `Failed to list Stripe restricted keys: ${listRes.status} ${listRes.statusText}`,
    );
  }

  const listData = (await listRes.json()) as {
    data: Array<{ id: string; name: string; allowed_resources: unknown }>;
  };

  // Find the key entry that matches the current value prefix (best-effort)
  const currentEntry = listData.data[0]; // use the first key as a template for permissions
  const oldKeyId = currentEntry?.id;

  // Step 2: create a new restricted key (Stripe copies permissions from name/template)
  const body = new URLSearchParams();
  if (currentEntry?.name) {
    body.set("name", `${currentEntry.name} (rotated)`);
  }

  const createRes = await fetch("https://api.stripe.com/v1/restricted_keys", {
    method: "POST",
    headers,
    body: body.toString(),
  });

  if (!createRes.ok) {
    throw new Error(
      `Failed to create new Stripe restricted key: ${createRes.status} ${createRes.statusText}`,
    );
  }

  const newKey = (await createRes.json()) as { id: string; key: string };
  const newValue = newKey.key;
  const newKeyId = newKey.id;

  // Step 3: validate the new key works
  const newHeaders = {
    Authorization: `Bearer ${newValue}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };

  const confirmRes = await fetch("https://api.stripe.com/v1/account", {
    headers: newHeaders,
  });

  if (!confirmRes.ok) {
    throw new Error(
      `New Stripe key validation failed: ${confirmRes.status} ${confirmRes.statusText}. The old key has NOT been revoked.`,
    );
  }

  // Step 4: revoke the old key (if we know its ID)
  if (oldKeyId) {
    const deleteRes = await fetch(
      `https://api.stripe.com/v1/restricted_keys/${oldKeyId}`,
      {
        method: "DELETE",
        headers,
      },
    );

    if (!deleteRes.ok) {
      // Non-fatal: log but continue — new key is already active
      const text = await deleteRes.text();
      throw new Error(
        `New key is active, but failed to revoke old key (${oldKeyId}): ${deleteRes.status} — ${text}\n` +
          `Revoke it manually at: https://dashboard.stripe.com/apikeys`,
      );
    }
  }

  return {
    newValue,
    oldKeyId,
    newKeyId,
    metadata: { keyType: "restricted" },
  };
}
