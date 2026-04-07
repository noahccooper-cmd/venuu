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

export async function hapticSuccess() {
  try { await Haptics.notification({ type: NotificationType.Success }); } catch {}
}

export async function hapticError() {
  try { await Haptics.notification({ type: NotificationType.Error }); } catch {}
}
