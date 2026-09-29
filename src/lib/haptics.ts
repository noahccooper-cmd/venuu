/**
 * Haptic feedback utility — wraps @capacitor/haptics with silent fallback.
 * All calls are fire-and-forget. Never throws. Safe on web/simulator.
 */

import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

export async function hapticLight() {
  try { await Haptics.impact({ style: ImpactStyle.Light }); } catch {}
}

export async function hapticMedium() {
  try { await Haptics.impact({ style: ImpactStyle.Medium }); } catch {}
}

export async function hapticHeavy() {
  try { await Haptics.impact({ style: ImpactStyle.Heavy }); } catch {}
}

/**
 * Selection-style tick — the lightest haptic the OS exposes.
 * Used for sheet snap transitions where we want a confirmation
 * cue without the weight of an impact pulse.
 */
export async function hapticTick() {
  try { await Haptics.selectionStart(); } catch {}
}

export async function hapticSuccess() {
  try { await Haptics.notification({ type: NotificationType.Success }); } catch {}
}

export async function hapticError() {
  try { await Haptics.notification({ type: NotificationType.Error }); } catch {}
}

/** Selection change (carousel/feed snap, filter or city switch). */
export async function hapticSelection() {
  try {
    await Haptics.selectionStart();
    await Haptics.selectionChanged();
    await Haptics.selectionEnd();
  } catch {}
}

export async function hapticWarning() {
  try { await Haptics.notification({ type: NotificationType.Warning }); } catch {}
}
