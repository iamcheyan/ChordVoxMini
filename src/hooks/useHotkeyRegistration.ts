import { useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { formatHotkeyLabel } from "../utils/hotkeys";
import { validateHotkey } from "../utils/hotkeyValidator";
import { getPlatform } from "../utils/platform";

export interface UseHotkeyRegistrationOptions {
  /**
   * Callback fired when hotkey is successfully registered
   */
  onSuccess?: (hotkey: string) => void;

  /**
   * Callback fired when hotkey registration fails
   */
  onError?: (error: string, hotkey: string) => void;

  /**
   * Show toast notification on success (default: true)
   */
  showSuccessToast?: boolean;

  /**
   * Show toast notification on error (default: true)
   */
  showErrorToast?: boolean;

  /**
   * Custom toast/alert function for showing messages
   */
  showAlert?: (options: { title: string; description: string }) => void;

  /**
   * Custom registration function (e.g. for secondary/tertiary hotkeys)
   * Defaults to window.electronAPI.updateHotkey
   */
  registrationFn?: (hotkey: string) => Promise<{ success: boolean; message?: string }>;
}

export interface UseHotkeyRegistrationResult {
  /**
   * Register a new hotkey with the system
   */
  registerHotkey: (hotkey: string) => Promise<boolean>;

  /**
   * Whether a registration is currently in progress
   */
  isRegistering: boolean;

  /**
   * The last error message, if any
   */
  lastError: string | null;

  /**
   * Clear the last error
   */
  clearError: () => void;
}

/**
 * Shared hook for hotkey registration with consistent error handling
 * and success/failure notifications.
 *
 * @example
 * const { registerHotkey, isRegistering } = useHotkeyRegistration({
 *   onSuccess: (hotkey) => setDictationKey(hotkey),
 *   showAlert: showAlertDialog,
 * });
 *
 * // Later, when user selects a hotkey:
 * await registerHotkey("CommandOrControl+Shift+K");
 */
export function useHotkeyRegistration(
  options: UseHotkeyRegistrationOptions = {}
): UseHotkeyRegistrationResult {
  const { t } = useTranslation();
  const {
    onSuccess,
    onError,
    showSuccessToast = true,
    showErrorToast = true,
    showAlert,
    registrationFn: customRegistrationFn,
  } = options;

  const [isRegistering, setIsRegistering] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Use ref to track in-flight requests and prevent double registration
  const registrationInFlightRef = useRef(false);

  const clearError = useCallback(() => {
    setLastError(null);
  }, []);

  const registerHotkey = useCallback(
    async (hotkey: string): Promise<boolean> => {
      // Prevent double registration
      if (registrationInFlightRef.current) {
        return false;
      }

      const isClearing = !hotkey || hotkey.trim() === "";

      // Validate hotkey format if not clearing
      if (!isClearing) {
        const platform = getPlatform();
        const validation = validateHotkey(hotkey, platform);
        if (!validation.valid) {
          const errorMsg =
            validation.error || t("hooks.hotkeyRegistration.errors.unsupportedShortcut");
          setLastError(errorMsg);
          if (showErrorToast && showAlert) {
            showAlert({
              title: t("hooks.hotkeyRegistration.titles.invalidHotkey"),
              description: errorMsg,
            });
          }
          onError?.(errorMsg, hotkey);
          return false;
        }
      }

      // Check if registration function is available
      const updateFn = customRegistrationFn || window.electronAPI?.updateHotkey;
      if (!updateFn) {
        // In non-Electron environment or if API missing, just succeed silently
        onSuccess?.(hotkey);
        return true;
      }

      try {
        registrationInFlightRef.current = true;
        setIsRegistering(true);
        setLastError(null);

        const result = await updateFn(hotkey);

        if (!result?.success) {
          // Use the detailed error message from the manager, which includes suggestions
          const errorMsg = result?.message || t("hooks.hotkeyRegistration.errors.couldNotRegister");
          setLastError(errorMsg);

          if (showErrorToast && showAlert) {
            showAlert({
              title: t("hooks.hotkeyRegistration.titles.notRegistered"),
              description: errorMsg,
            });
          }

          onError?.(errorMsg, hotkey);
          return false;
        }

        // Success!
        if (showSuccessToast && showAlert) {
          if (isClearing) {
            showAlert({
              title: t("hooks.hotkeyRegistration.titles.saved"),
              description: t("hooks.hotkeyRegistration.messages.cleared"),
            });
          } else {
            const displayLabel = formatHotkeyLabel(hotkey);
            showAlert({
              title: t("hooks.hotkeyRegistration.titles.saved"),
              description: t("hooks.hotkeyRegistration.messages.nowUsing", { hotkey: displayLabel }),
            });
          }
        }

        onSuccess?.(hotkey);
        return true;
      } catch (error) {
        const errorMsg =
          error instanceof Error
            ? error.message
            : t("hooks.hotkeyRegistration.errors.failedToRegister");
        setLastError(errorMsg);

        if (showErrorToast && showAlert) {
          showAlert({
            title: t("hooks.hotkeyRegistration.titles.error"),
            description: errorMsg,
          });
        }

        onError?.(errorMsg, hotkey);
        return false;
      } finally {
        setIsRegistering(false);
        registrationInFlightRef.current = false;
      }
    },
    [onSuccess, onError, showSuccessToast, showErrorToast, showAlert, customRegistrationFn, t]
  );

  return {
    registerHotkey,
    isRegistering,
    lastError,
    clearError,
  };
}

export default useHotkeyRegistration;
