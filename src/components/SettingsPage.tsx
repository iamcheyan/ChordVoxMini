import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import {
  RefreshCw,
  Download,
  Upload,
  Command,
  Mic,
  Shield,
  FolderOpen,
  Sun,
  Moon,
  Monitor,
  Key,
  Loader2,
} from "lucide-react";
import MarkdownRenderer from "./ui/MarkdownRenderer";
import MicPermissionWarning from "./ui/MicPermissionWarning";
import MicrophoneSettings from "./ui/MicrophoneSettings";
import PermissionCard from "./ui/PermissionCard";
import PasteToolsInfo from "./ui/PasteToolsInfo";
import TranscriptionModelPicker from "./TranscriptionModelPicker";
import { ConfirmDialog, AlertDialog } from "./ui/dialog";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { useSettings } from "../hooks/useSettings";
import { useDialogs } from "../hooks/useDialogs";
import { useWhisper } from "../hooks/useWhisper";
import { usePermissions } from "../hooks/usePermissions";
import { useClipboard } from "../hooks/useClipboard";
import { useUpdater } from "../hooks/useUpdater";

import PromptStudio from "./ui/PromptStudio";
import ReasoningModelSelector from "./ReasoningModelSelector";

import { HotkeyInput } from "./ui/HotkeyInput";
import HotkeyGuidanceAccordion from "./ui/HotkeyGuidanceAccordion";
import { useHotkeyRegistration } from "../hooks/useHotkeyRegistration";
import { getValidationMessage } from "../utils/hotkeyValidator";
import { getPlatform } from "../utils/platform";
import { ActivationModeSelector } from "./ui/ActivationModeSelector";
import { Toggle } from "./ui/toggle";
import DeveloperSection from "./DeveloperSection";
import LanguageSelector from "./ui/LanguageSelector";
import { Skeleton } from "./ui/skeleton";
import { Progress } from "./ui/progress";
import { useToast } from "./ui/Toast";
import { useTheme } from "../hooks/useTheme";
import type { LocalTranscriptionProvider } from "../types/electron";
import logger from "../utils/logger";
import { SettingsRow } from "./ui/SettingsSection";
import { cn } from "./lib/utils";

export type SettingsSectionType =
  | "account"
  | "general"
  | "transcription"
  | "dictionary"
  | "aiModels"
  | "prompts"
  | "permissions"
  | "privacy"
  | "developer";

interface SettingsPageProps {
  activeSection?: SettingsSectionType;
  onOpenTranscriptionHistory?: () => void;
}

const UI_LANGUAGE_OPTIONS: import("./ui/LanguageSelector").LanguageOption[] = [
  { value: "en", label: "English", flag: "🇺🇸" },
  { value: "es", label: "Español", flag: "🇪🇸" },
  { value: "fr", label: "Français", flag: "🇫🇷" },
  { value: "de", label: "Deutsch", flag: "🇩🇪" },
  { value: "pt", label: "Português", flag: "🇵🇹" },
  { value: "it", label: "Italiano", flag: "🇮🇹" },
  { value: "ru", label: "Русский", flag: "🇷🇺" },
  { value: "ja", label: "日本語", flag: "🇯🇵" },
  { value: "zh-CN", label: "简体中文", flag: "🇨🇳" },
  { value: "zh-TW", label: "繁體中文", flag: "🇹🇼" },
];

const MODIFIER_PARTS = new Set([
  "control",
  "ctrl",
  "alt",
  "option",
  "shift",
  "super",
  "meta",
  "win",
  "command",
  "cmd",
  "commandorcontrol",
  "cmdorctrl",
  "fn",
]);

function SettingsPanel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-border/50 dark:border-border-subtle/70 bg-card/50 dark:bg-surface-2/50 backdrop-blur-sm divide-y divide-border/30 dark:divide-border-subtle/50 ${className}`}
    >
      {children}
    </div>
  );
}

function SettingsPanelRow({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`px-4 py-3 ${className}`}>{children}</div>;
}

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-[13px] font-semibold text-foreground tracking-tight">{title}</h3>
      {description && (
        <p className="text-[11px] text-muted-foreground/80 mt-0.5 leading-relaxed">{description}</p>
      )}
    </div>
  );
}

interface TranscriptionSectionProps {
  useLocalWhisper: boolean;
  setUseLocalWhisper: (value: boolean) => void;
  updateTranscriptionSettings: (settings: { useLocalWhisper: boolean }) => void;
  cloudTranscriptionProvider: string;
  setCloudTranscriptionProvider: (provider: string) => void;
  cloudTranscriptionModel: string;
  setCloudTranscriptionModel: (model: string) => void;
  localTranscriptionProvider: string;
  setLocalTranscriptionProvider: (provider: LocalTranscriptionProvider) => void;
  whisperModel: string;
  setWhisperModel: (model: string) => void;
  parakeetModel: string;
  setParakeetModel: (model: string) => void;
  senseVoiceModelPath: string;
  setSenseVoiceModelPath: (path: string) => void;
  senseVoiceBinaryPath: string;
  setSenseVoiceBinaryPath: (path: string) => void;
  paraformerModelPath: string;
  setParaformerModelPath: (path: string) => void;
  paraformerBinaryPath: string;
  setParaformerBinaryPath: (path: string) => void;
  openaiApiKey: string;
  setOpenaiApiKey: (key: string) => void;
  groqApiKey: string;
  setGroqApiKey: (key: string) => void;
  mistralApiKey: string;
  setMistralApiKey: (key: string) => void;
  customTranscriptionApiKey: string;
  setCustomTranscriptionApiKey: (key: string) => void;
  cloudTranscriptionBaseUrl?: string;
  setCloudTranscriptionBaseUrl: (url: string) => void;
  toast: (opts: {
    title: string;
    description: string;
    variant?: "default" | "destructive" | "success";
    duration?: number;
  }) => void;
  isSignedIn: boolean;
  localModelsDir: string;
  cloudTranscriptionMode: string;
  setCloudTranscriptionMode: (mode: string) => void;
}

function TranscriptionSection({
  useLocalWhisper,
  setUseLocalWhisper,
  updateTranscriptionSettings,
  cloudTranscriptionProvider,
  setCloudTranscriptionProvider,
  cloudTranscriptionModel,
  setCloudTranscriptionModel,
  localTranscriptionProvider,
  setLocalTranscriptionProvider,
  whisperModel,
  setWhisperModel,
  parakeetModel,
  setParakeetModel,
  senseVoiceModelPath,
  setSenseVoiceModelPath,
  senseVoiceBinaryPath,
  setSenseVoiceBinaryPath,
  paraformerModelPath,
  setParaformerModelPath,
  paraformerBinaryPath,
  setParaformerBinaryPath,
  openaiApiKey,
  setOpenaiApiKey,
  groqApiKey,
  setGroqApiKey,
  mistralApiKey,
  setMistralApiKey,
  customTranscriptionApiKey,
  setCustomTranscriptionApiKey,
  cloudTranscriptionBaseUrl,
  setCloudTranscriptionBaseUrl,
  toast,
  isSignedIn,
  localModelsDir,
  cloudTranscriptionMode,
  setCloudTranscriptionMode,
}: TranscriptionSectionProps) {
  const { t, i18n } = useTranslation();
  const isCustomMode = useLocalWhisper;

  return (
    <div className="space-y-4">
      <SectionHeader
        title={t("settingsPage.transcription.title")}
        description={t("settingsPage.transcription.description")}
      />

      {/* Model picker */}
      <TranscriptionModelPicker
        selectedCloudProvider={cloudTranscriptionProvider}
        onCloudProviderSelect={setCloudTranscriptionProvider}
        selectedCloudModel={cloudTranscriptionModel}
        onCloudModelSelect={setCloudTranscriptionModel}
        selectedLocalModel={
          localTranscriptionProvider === "nvidia"
            ? parakeetModel
            : localTranscriptionProvider === "sensevoice"
              ? senseVoiceModelPath
              : localTranscriptionProvider === "paraformer"
                ? paraformerModelPath
                : whisperModel
        }
        onLocalModelSelect={(modelId, providerId) => {
          const targetProvider = providerId || localTranscriptionProvider;
          if (targetProvider === "nvidia") {
            setParakeetModel(modelId);
          } else if (targetProvider === "sensevoice") {
            setSenseVoiceModelPath(modelId);
          } else if (targetProvider === "paraformer") {
            setParaformerModelPath(modelId);
          } else {
            setWhisperModel(modelId);
          }
        }}
        selectedLocalProvider={localTranscriptionProvider}
        onLocalProviderSelect={setLocalTranscriptionProvider}
        useLocalWhisper={useLocalWhisper}
        onModeChange={(isLocal) => {
          setUseLocalWhisper(isLocal);
          updateTranscriptionSettings({ useLocalWhisper: isLocal });
        }}
        openaiApiKey={openaiApiKey}
        setOpenaiApiKey={setOpenaiApiKey}
        groqApiKey={groqApiKey}
        setGroqApiKey={setGroqApiKey}
        mistralApiKey={mistralApiKey}
        setMistralApiKey={setMistralApiKey}
        customTranscriptionApiKey={customTranscriptionApiKey}
        setCustomTranscriptionApiKey={setCustomTranscriptionApiKey}
        senseVoiceModelPath={senseVoiceModelPath}
        setSenseVoiceModelPath={setSenseVoiceModelPath}
        senseVoiceBinaryPath={senseVoiceBinaryPath}
        setSenseVoiceBinaryPath={setSenseVoiceBinaryPath}
        paraformerModelPath={paraformerModelPath}
        setParaformerModelPath={setParaformerModelPath}
        paraformerBinaryPath={paraformerBinaryPath}
        setParaformerBinaryPath={setParaformerBinaryPath}
        cloudTranscriptionBaseUrl={cloudTranscriptionBaseUrl}
        setCloudTranscriptionBaseUrl={setCloudTranscriptionBaseUrl}
        variant="settings"
      />
    </div>
  );
}

interface AiModelsSectionProps {
  cloudReasoningMode: string;
  setCloudReasoningMode: (mode: string) => void;
  useReasoningModel: boolean;
  setUseReasoningModel: (value: boolean) => void;
  reasoningModel: string;
  setReasoningModel: (model: string) => void;
  reasoningProvider: string;
  setReasoningProvider: (provider: string) => void;
  cloudReasoningBaseUrl: string;
  setCloudReasoningBaseUrl: (url: string) => void;
  openaiApiKey: string;
  setOpenaiApiKey: (key: string) => void;
  anthropicApiKey: string;
  setAnthropicApiKey: (key: string) => void;
  geminiApiKey: string;
  setGeminiApiKey: (key: string) => void;
  groqApiKey: string;
  setGroqApiKey: (key: string) => void;
  openrouterApiKey: string;
  setOpenrouterApiKey: (key: string) => void;
  customReasoningApiKey: string;
  setCustomReasoningApiKey: (key: string) => void;
  localModelsDir: string;
  setLocalModelsDir: (dir: string) => void;
  isSignedIn: boolean;
  showAlertDialog: (dialog: { title: string; description: string }) => void;
  toast: (opts: {
    title: string;
    description: string;
    variant?: "default" | "destructive" | "success";
    duration?: number;
  }) => void;
}

function AiModelsSection({
  cloudReasoningMode,
  setCloudReasoningMode,
  useReasoningModel,
  setUseReasoningModel,
  reasoningModel,
  setReasoningModel,
  reasoningProvider,
  setReasoningProvider,
  cloudReasoningBaseUrl,
  setCloudReasoningBaseUrl,
  openaiApiKey,
  setOpenaiApiKey,
  anthropicApiKey,
  setAnthropicApiKey,
  geminiApiKey,
  setGeminiApiKey,
  groqApiKey,
  setGroqApiKey,
  openrouterApiKey,
  setOpenrouterApiKey,
  customReasoningApiKey,
  setCustomReasoningApiKey,
  localModelsDir,
  setLocalModelsDir,
  isSignedIn,
  showAlertDialog,
  toast,
}: AiModelsSectionProps) {
  const { t, i18n } = useTranslation();
  const isCustomMode = true;
  const isCloudMode = false;

  return (
    <div className="space-y-4">
      <SectionHeader
        title={t("settingsPage.aiModels.title")}
        description={t("settingsPage.aiModels.description")}
      />

      {/* Enable toggle — always at top */}
      <SettingsPanel>
        <SettingsPanelRow>
          <SettingsRow
            label={t("settingsPage.aiModels.enableTextCleanup")}
            description={t("settingsPage.aiModels.enableTextCleanupDescription")}
          >
            <Toggle checked={useReasoningModel} onChange={setUseReasoningModel} />
          </SettingsRow>
        </SettingsPanelRow>
      </SettingsPanel>

      {useReasoningModel && (
        <>


          {/* Custom Setup model picker — shown when Custom Setup is active or not signed in */}
          {(isCustomMode || !isSignedIn) && (
            <ReasoningModelSelector
              useReasoningModel={useReasoningModel}
              setUseReasoningModel={setUseReasoningModel}
              reasoningModel={reasoningModel}
              setReasoningModel={setReasoningModel}
              localReasoningProvider={reasoningProvider}
              setLocalReasoningProvider={setReasoningProvider}
              cloudReasoningBaseUrl={cloudReasoningBaseUrl}
              setCloudReasoningBaseUrl={setCloudReasoningBaseUrl}
              openaiApiKey={openaiApiKey}
              setOpenaiApiKey={setOpenaiApiKey}
              openrouterApiKey={openrouterApiKey}
              setOpenrouterApiKey={setOpenrouterApiKey}
              anthropicApiKey={anthropicApiKey}
              setAnthropicApiKey={setAnthropicApiKey}
              geminiApiKey={geminiApiKey}
              setGeminiApiKey={setGeminiApiKey}
              groqApiKey={groqApiKey}
              setGroqApiKey={setGroqApiKey}
              customReasoningApiKey={customReasoningApiKey}
              setCustomReasoningApiKey={setCustomReasoningApiKey}
              showAlertDialog={showAlertDialog}
            />
          )}
        </>
      )}
    </div>
  );
}

export default function SettingsPage({
  activeSection = "general",
  onOpenTranscriptionHistory,
}: SettingsPageProps) {
  const {
    confirmDialog,
    alertDialog,
    showConfirmDialog,
    showAlertDialog,
    hideConfirmDialog,
    hideAlertDialog,
  } = useDialogs();

  const {
    useLocalWhisper,
    whisperModel,
    localTranscriptionProvider,
    parakeetModel,
    senseVoiceModelPath,
    senseVoiceBinaryPath,
    paraformerModelPath,
    paraformerBinaryPath,
    uiLanguage,
    preferredLanguage,
    cloudTranscriptionProvider,
    cloudTranscriptionModel,
    cloudTranscriptionBaseUrl,
    cloudReasoningBaseUrl,
    customDictionary,
    useReasoningModel,
    reasoningModel,
    reasoningProvider,
    openaiApiKey,
    openrouterApiKey,
    anthropicApiKey,
    geminiApiKey,
    groqApiKey,
    mistralApiKey,
    dictationKey,
    dictationKeySecondary,
    secondaryHotkeyProfile,
    activationMode,
    setActivationMode,
    preferBuiltInMic,
    selectedMicDeviceId,
    setPreferBuiltInMic,
    setSelectedMicDeviceId,
    setUseLocalWhisper,
    setUiLanguage,
    setWhisperModel,
    setLocalTranscriptionProvider,
    setParakeetModel,
    setSenseVoiceModelPath,
    setSenseVoiceBinaryPath,
    setParaformerModelPath,
    setParaformerBinaryPath,
    setCloudTranscriptionProvider,
    setCloudTranscriptionModel,
    setCloudTranscriptionBaseUrl,
    setCloudReasoningBaseUrl,
    setCustomDictionary,
    setUseReasoningModel,
    setReasoningModel,
    setReasoningProvider,
    setOpenaiApiKey,
    setOpenrouterApiKey,
    setAnthropicApiKey,
    setGeminiApiKey,
    setGroqApiKey,
    setMistralApiKey,
    customTranscriptionApiKey,
    setCustomTranscriptionApiKey,
    customReasoningApiKey,
    setCustomReasoningApiKey,
    setDictationKey,
    setDictationKeySecondary,
    captureSecondaryHotkeyProfileFromCurrent,
    updateTranscriptionSettings,
    updateReasoningSettings,
    cloudTranscriptionMode,
    setCloudTranscriptionMode,
    cloudReasoningMode,
    setCloudReasoningMode,
    audioCuesEnabled,
    setAudioCuesEnabled,
    floatingIconAutoHide,
    setFloatingIconAutoHide,
    cloudBackupEnabled,
    setCloudBackupEnabled,
    telemetryEnabled,
    setTelemetryEnabled,
    transcriptionHistoryEnabled,
    setTranscriptionHistoryEnabled,
    localModelsDir,
    setLocalModelsDir,
  } = useSettings();

  const isSignedIn = false;

  const { t, i18n } = useTranslation();
  const { toast } = useToast();

  const [currentVersion, setCurrentVersion] = useState<string>("");
  const [isRemovingModels, setIsRemovingModels] = useState(false);
  const cachePathHint =
    typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent)
      ? "%USERPROFILE%\\.cache\\chordvox"
      : "~/.cache/chordvox";

  const {
    status: updateStatus,
    info: updateInfo,
    downloadProgress: updateDownloadProgress,
    isChecking: checkingForUpdates,
    isDownloading: downloadingUpdate,
    isInstalling: installInitiated,
    checkForUpdates,
    downloadUpdate,
    installUpdate: installUpdateAction,
    getAppVersion,
  } = useUpdater();

  const isUpdateAvailable =
    !updateStatus.isDevelopment && (updateStatus.updateAvailable || updateStatus.updateDownloaded);
  const manualUpdateUrl =
    updateInfo && updateInfo.manualOnly && updateInfo.manualDownloadUrl
      ? updateInfo.manualDownloadUrl
      : "";
  const isManualUpdate = Boolean(manualUpdateUrl);

  const whisperHook = useWhisper();
  const permissionsHook = usePermissions(showAlertDialog);
  useClipboard(showAlertDialog);
  const { theme, setTheme } = useTheme();

  const installTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { registerHotkey, isRegistering: isHotkeyRegistering } = useHotkeyRegistration({
    onSuccess: (registeredHotkey) => {
      setDictationKey(registeredHotkey);
    },
    showSuccessToast: false,
    showErrorToast: true,
    showAlert: showAlertDialog,
  });

  const validateHotkeyForInput = useCallback(
    (hotkey: string) => getValidationMessage(hotkey, getPlatform()),
    []
  );

  const validateSecondaryHotkeyForInput = useCallback(
    (hotkey: string) => {
      const baseValidation = getValidationMessage(hotkey, getPlatform());
      if (baseValidation) return baseValidation;

      const normalized = hotkey?.trim() || "";
      if (!normalized) return null;

      if (normalized === "GLOBE") {
        return t("settingsPage.general.hotkey.secondary.globeNotSupported");
      }

      if (
        /^Right(Control|Ctrl|Alt|Option|Shift|Super|Win|Meta|Command|Cmd)$/i.test(normalized)
      ) {
        return t("settingsPage.general.hotkey.secondary.rightModifierNotSupported");
      }

      if (
        normalized.includes("+") &&
        normalized
          .split("+")
          .map((part) => part.trim().toLowerCase())
          .every((part) => MODIFIER_PARTS.has(part))
      ) {
        return t("settingsPage.general.hotkey.secondary.modifiersOnlyNotSupported");
      }

      return null;
    },
    [t]
  );

  const [isSecondaryHotkeyRegistering, setIsSecondaryHotkeyRegistering] = useState(false);

  const registerSecondaryHotkey = useCallback(
    async (hotkey: string) => {
      if (!hotkey || !hotkey.trim()) {
        try {
          setIsSecondaryHotkeyRegistering(true);
          await window.electronAPI?.updateSecondaryHotkey?.("");
          setDictationKeySecondary("");
          return true;
        } finally {
          setIsSecondaryHotkeyRegistering(false);
        }
      }

      const validationError = validateSecondaryHotkeyForInput(hotkey);
      if (validationError) {
        showAlertDialog({
          title: t("hooks.hotkeyRegistration.titles.invalidHotkey"),
          description: validationError,
        });
        return false;
      }

      if (!window.electronAPI?.updateSecondaryHotkey) {
        setDictationKeySecondary(hotkey);
        return true;
      }

      try {
        setIsSecondaryHotkeyRegistering(true);
        const result = await window.electronAPI.updateSecondaryHotkey(hotkey);
        if (!result?.success) {
          showAlertDialog({
            title: t("hooks.hotkeyRegistration.titles.notRegistered"),
            description:
              result?.message || t("settingsPage.general.hotkey.secondary.registerFailed"),
          });
          return false;
        }

        setDictationKeySecondary(hotkey);
        toast({
          title: t("settingsPage.general.hotkey.secondary.savedTitle"),
          description: t("settingsPage.general.hotkey.secondary.savedDescription"),
          variant: "success",
        });
        return true;
      } catch (error) {
        showAlertDialog({
          title: t("hooks.hotkeyRegistration.titles.error"),
          description:
            error instanceof Error
              ? error.message
              : t("settingsPage.general.hotkey.secondary.registerRetry"),
        });
        return false;
      } finally {
        setIsSecondaryHotkeyRegistering(false);
      }
    },
    [
      setDictationKeySecondary,
      showAlertDialog,
      t,
      toast,
      validateSecondaryHotkeyForInput,
    ]
  );

  const saveCurrentAsSecondaryProfile = useCallback(() => {
    captureSecondaryHotkeyProfileFromCurrent();
    toast({
      title: t("settingsPage.general.hotkey.secondary.profileSavedTitle"),
      description: t("settingsPage.general.hotkey.secondary.profileSavedDescription"),
      variant: "success",
    });
  }, [captureSecondaryHotkeyProfileFromCurrent, t, toast]);

  const [isUsingGnomeHotkeys, setIsUsingGnomeHotkeys] = useState(false);

  const platform = useMemo(() => {
    if (typeof window !== "undefined" && window.electronAPI?.getPlatform) {
      return window.electronAPI.getPlatform();
    }
    return "linux";
  }, []);

  const [newDictionaryWord, setNewDictionaryWord] = useState("");

  const handleAddDictionaryWord = useCallback(() => {
    const word = newDictionaryWord.trim();
    if (word && !customDictionary.includes(word)) {
      setCustomDictionary([...customDictionary, word]);
      setNewDictionaryWord("");
    }
  }, [newDictionaryWord, customDictionary, setCustomDictionary]);

  const handleRemoveDictionaryWord = useCallback(
    (wordToRemove: string) => {
      setCustomDictionary(customDictionary.filter((word) => word !== wordToRemove));
    },
    [customDictionary, setCustomDictionary]
  );

  const [autoStartEnabled, setAutoStartEnabled] = useState(false);
  const [autoStartLoading, setAutoStartLoading] = useState(true);

  useEffect(() => {
    if (platform === "linux") {
      setAutoStartLoading(false);
      return;
    }
    const loadAutoStart = async () => {
      if (window.electronAPI?.getAutoStartEnabled) {
        try {
          const enabled = await window.electronAPI.getAutoStartEnabled();
          setAutoStartEnabled(enabled);
        } catch (error) {
          logger.error("Failed to get auto-start status", error, "settings");
        }
      }
      setAutoStartLoading(false);
    };
    loadAutoStart();
  }, [platform]);

  const handleAutoStartChange = async (enabled: boolean) => {
    if (window.electronAPI?.setAutoStartEnabled) {
      try {
        setAutoStartLoading(true);
        const result = await window.electronAPI.setAutoStartEnabled(enabled);
        if (result.success) {
          setAutoStartEnabled(enabled);
        }
      } catch (error) {
        logger.error("Failed to set auto-start", error, "settings");
      } finally {
        setAutoStartLoading(false);
      }
    }
  };

  const [autoCheckUpdateEnabled, setAutoCheckUpdateEnabled] = useState(true);
  const [autoCheckUpdateLoading, setAutoCheckUpdateLoading] = useState(true);

  useEffect(() => {
    const loadAutoCheckUpdate = async () => {
      if (window.electronAPI?.getAutoCheckUpdate) {
        try {
          const enabled = await window.electronAPI.getAutoCheckUpdate();
          setAutoCheckUpdateEnabled(enabled);
        } catch (error) {
          logger.error("Failed to get auto-check-update status", error, "settings");
        }
      }
      setAutoCheckUpdateLoading(false);
    };
    loadAutoCheckUpdate();
  }, []);

  const handleAutoCheckUpdateChange = async (enabled: boolean) => {
    if (window.electronAPI?.setAutoCheckUpdate) {
      try {
        setAutoCheckUpdateLoading(true);
        const result = await window.electronAPI.setAutoCheckUpdate(enabled);
        if (result.success) {
          setAutoCheckUpdateEnabled(enabled);
        }
      } catch (error) {
        logger.error("Failed to set auto-check-update", error, "settings");
      } finally {
        setAutoCheckUpdateLoading(false);
      }
    }
  };

  useEffect(() => {
    let mounted = true;

    const timer = setTimeout(async () => {
      if (!mounted) return;

      const version = await getAppVersion();
      if (version && mounted) setCurrentVersion(version);

      if (mounted) {
        whisperHook.checkWhisperInstallation();
      }
    }, 100);

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [whisperHook, getAppVersion]);

  useEffect(() => {
    const checkHotkeyMode = async () => {
      try {
        const info = await window.electronAPI?.getHotkeyModeInfo();
        if (info?.isUsingGnome) {
          setIsUsingGnomeHotkeys(true);
          setActivationMode("tap");
        }
      } catch (error) {
        logger.error("Failed to check hotkey mode", error, "settings");
      }
    };
    checkHotkeyMode();
  }, [setActivationMode]);

  useEffect(() => {
    if (installInitiated) {
      if (installTimeoutRef.current) {
        clearTimeout(installTimeoutRef.current);
      }
      installTimeoutRef.current = setTimeout(() => {
        showAlertDialog({
          title: t("settingsPage.general.updates.dialogs.almostThere.title"),
          description: t("settingsPage.general.updates.dialogs.almostThere.description"),
        });
      }, 10000);
    } else if (installTimeoutRef.current) {
      clearTimeout(installTimeoutRef.current);
      installTimeoutRef.current = null;
    }

    return () => {
      if (installTimeoutRef.current) {
        clearTimeout(installTimeoutRef.current);
        installTimeoutRef.current = null;
      }
    };
  }, [installInitiated, showAlertDialog, t]);

  const resetAccessibilityPermissions = () => {
    const message = t("settingsPage.permissions.resetAccessibility.description");

    showConfirmDialog({
      title: t("settingsPage.permissions.resetAccessibility.title"),
      description: message,
      onConfirm: () => {
        permissionsHook.openAccessibilitySettings();
      },
    });
  };

  const handleRemoveModels = useCallback(() => {
    if (isRemovingModels) return;

    showConfirmDialog({
      title: t("settingsPage.developer.removeModels.title"),
      description: t("settingsPage.developer.removeModels.description", { path: cachePathHint }),
      confirmText: t("settingsPage.developer.removeModels.confirmText"),
      variant: "destructive",
      onConfirm: async () => {
        setIsRemovingModels(true);
        try {
          const results = await Promise.allSettled([
            window.electronAPI?.deleteAllWhisperModels?.(),
            window.electronAPI?.deleteAllParakeetModels?.(),
            window.electronAPI?.modelDeleteAll?.(),
          ]);

          const anyFailed = results.some(
            (r) =>
              r.status === "rejected" || (r.status === "fulfilled" && r.value && !r.value.success)
          );

          if (anyFailed) {
            showAlertDialog({
              title: t("settingsPage.developer.removeModels.failedTitle"),
              description: t("settingsPage.developer.removeModels.failedDescription"),
            });
          } else {
            window.dispatchEvent(new Event("local-models-cleared"));
            showAlertDialog({
              title: t("settingsPage.developer.removeModels.successTitle"),
              description: t("settingsPage.developer.removeModels.successDescription"),
            });
          }
        } catch {
          showAlertDialog({
            title: t("settingsPage.developer.removeModels.failedTitle"),
            description: t("settingsPage.developer.removeModels.failedDescriptionShort"),
          });
        } finally {
          setIsRemovingModels(false);
        }
      },
    });
  }, [isRemovingModels, cachePathHint, showConfirmDialog, showAlertDialog, t]);

  const collectSettingsSnapshot = useCallback(async () => {
    const localStorageData: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      const value = localStorage.getItem(key);
      if (value !== null) {
        localStorageData[key] = value;
      }
    }

    const dictionary =
      (await window.electronAPI?.getDictionary?.().catch(() => [])) ||
      [];
    const dictationKey = await window.electronAPI?.getDictationKey?.().catch(() => null);
    const activationMode = await window.electronAPI?.getActivationMode?.().catch(() => null);
    const licenseApiBaseUrl = await window.electronAPI
      ?.getLicenseApiBaseUrl?.()
      .catch(() => null);

    return {
      schemaVersion: 1,
      app: "ChordVox",
      exportedAt: new Date().toISOString(),
      appVersion: currentVersion || (await getAppVersion()) || null,
      localStorage: localStorageData,
      dictionary: Array.isArray(dictionary) ? dictionary : [],
      runtime: {
        dictationKey,
        activationMode,
        licenseApiBaseUrl,
      },
    };
  }, [currentVersion, getAppVersion]);

  const handleExportSettings = useCallback(async () => {
    if (!window.electronAPI?.exportSettingsFile) return;
    try {
      const snapshot = await collectSettingsSnapshot();
      const result = await window.electronAPI.exportSettingsFile(snapshot);
      if (!result.success) {
        throw new Error(result.error || "Failed to export settings");
      }
      if (result.cancelled) {
        return;
      }
      showAlertDialog({
        title: t("settingsPage.developer.settingsTransfer.exportSuccessTitle"),
        description: t("settingsPage.developer.settingsTransfer.exportSuccessDescription", {
          path: result.filePath || "",
        }),
      });
    } catch (error) {
      showAlertDialog({
        title: t("settingsPage.developer.settingsTransfer.exportFailedTitle"),
        description: t("settingsPage.developer.settingsTransfer.exportFailedDescription"),
      });
    }
  }, [collectSettingsSnapshot, showAlertDialog, t]);

  const applyImportedSettings = useCallback(
    async (data: any) => {
      if (!data || typeof data !== "object") {
        throw new Error("Invalid settings payload");
      }

      const localStorageData =
        data.localStorage && typeof data.localStorage === "object" ? data.localStorage : data;

      if (!localStorageData || typeof localStorageData !== "object") {
        throw new Error("Invalid localStorage data");
      }

      localStorage.clear();
      Object.entries(localStorageData).forEach(([key, value]) => {
        localStorage.setItem(key, String(value ?? ""));
      });

      const parsedDictionary = (() => {
        if (Array.isArray(data.dictionary)) return data.dictionary;
        const raw = localStorageData.customDictionary;
        if (Array.isArray(raw)) return raw;
        if (typeof raw === "string") {
          try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : null;
          } catch {
            return null;
          }
        }
        return null;
      })();

      if (parsedDictionary && window.electronAPI?.setDictionary) {
        await window.electronAPI.setDictionary(
          parsedDictionary
            .filter((word: any) => typeof word === "string")
            .map((word: string) => word.trim())
            .filter(Boolean)
        );
      }

      const dictationKey = data?.runtime?.dictationKey || localStorageData.dictationKey;
      if (typeof dictationKey === "string" && window.electronAPI?.saveDictationKey) {
        await window.electronAPI.saveDictationKey(dictationKey);
      }

      const activationMode = data?.runtime?.activationMode || localStorageData.activationMode;
      if (
        (activationMode === "tap" || activationMode === "push") &&
        window.electronAPI?.saveActivationMode
      ) {
        await window.electronAPI.saveActivationMode(activationMode);
      }

      const licenseApiBaseUrl =
        data?.runtime?.licenseApiBaseUrl || localStorageData.licenseApiBaseUrl;
      if (typeof licenseApiBaseUrl === "string" && window.electronAPI?.saveLicenseApiBaseUrl) {
        await window.electronAPI.saveLicenseApiBaseUrl(licenseApiBaseUrl);
      }

      if (window.electronAPI?.saveAllKeysToEnv) {
        await window.electronAPI.saveAllKeysToEnv();
      }

      if (window.electronAPI?.syncStartupPreferences) {
        const localProviderRaw = String(localStorageData.localTranscriptionProvider || "whisper");
        const localProvider: LocalTranscriptionProvider =
          localProviderRaw === "nvidia" || localProviderRaw === "sensevoice"
            ? localProviderRaw
            : "whisper";
        const useLocalWhisperValue = String(localStorageData.useLocalWhisper || "false") === "true";
        const reasoningProviderValue = String(localStorageData.reasoningProvider || "openai");

        let model = String(localStorageData.whisperModel || "base");
        if (localProvider === "nvidia") {
          model = String(localStorageData.parakeetModel || "");
        } else if (localProvider === "sensevoice") {
          model = String(localStorageData.senseVoiceModelPath || "");
        }

        await window.electronAPI.syncStartupPreferences({
          useLocalWhisper: useLocalWhisperValue,
          localTranscriptionProvider: localProvider,
          model: model || undefined,
          senseVoiceBinaryPath:
            localProvider === "sensevoice" && localStorageData.senseVoiceBinaryPath
              ? String(localStorageData.senseVoiceBinaryPath)
              : undefined,
          reasoningProvider: reasoningProviderValue,
          reasoningModel:
            reasoningProviderValue === "local" && localStorageData.reasoningModel
              ? String(localStorageData.reasoningModel)
              : undefined,
        });
      }
    },
    []
  );

  const handleImportSettings = useCallback(async () => {
    if (!window.electronAPI?.importSettingsFile) return;
    try {
      const result = await window.electronAPI.importSettingsFile();
      if (!result.success) {
        throw new Error(result.error || "Failed to import settings");
      }
      if (result.cancelled) {
        return;
      }
      const importedData = result.data;
      showConfirmDialog({
        title: t("settingsPage.developer.settingsTransfer.importConfirmTitle"),
        description: t("settingsPage.developer.settingsTransfer.importConfirmDescription"),
        confirmText: t("settingsPage.developer.settingsTransfer.importConfirmButton"),
        onConfirm: async () => {
          try {
            await applyImportedSettings(importedData);
            showAlertDialog({
              title: t("settingsPage.developer.settingsTransfer.importSuccessTitle"),
              description: t("settingsPage.developer.settingsTransfer.importSuccessDescription"),
            });
            setTimeout(() => {
              window.location.reload();
            }, 800);
          } catch (error) {
            showAlertDialog({
              title: t("settingsPage.developer.settingsTransfer.importFailedTitle"),
              description: t("settingsPage.developer.settingsTransfer.importFailedDescription"),
            });
          }
        },
        variant: "destructive",
      });
    } catch (error) {
      showAlertDialog({
        title: t("settingsPage.developer.settingsTransfer.importFailedTitle"),
        description: t("settingsPage.developer.settingsTransfer.importFailedDescription"),
      });
    }
  }, [applyImportedSettings, showAlertDialog, showConfirmDialog, t]);

  const renderSectionContent = () => {
    switch (activeSection) {
      case "account":
        return null;

      case "general":
        return (
          <div className="space-y-6">
            {/* Updates */}
            <div>
              <SectionHeader title={t("settingsPage.general.updates.title")} />
              <SettingsPanel>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settingsPage.general.updates.currentVersion")}
                    description={
                      updateStatus.isDevelopment
                        ? t("settingsPage.general.updates.devMode")
                        : isUpdateAvailable
                          ? t("settingsPage.general.updates.newVersionAvailable")
                          : t("settingsPage.general.updates.latestVersion")
                    }
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-[13px] tabular-nums text-muted-foreground font-mono">
                        {currentVersion || t("settingsPage.general.updates.versionPlaceholder")}
                      </span>
                      {updateStatus.isDevelopment ? (
                        <Badge variant="warning">
                          {t("settingsPage.general.updates.badges.dev")}
                        </Badge>
                      ) : isUpdateAvailable ? (
                        <Badge variant="success">
                          {t("settingsPage.general.updates.badges.update")}
                        </Badge>
                      ) : (
                        <Badge variant="outline">
                          {t("settingsPage.general.updates.badges.latest")}
                        </Badge>
                      )}
                    </div>
                  </SettingsRow>
                </SettingsPanelRow>

                <SettingsPanelRow>
                  <div className="space-y-2.5">
                    <Button
                      onClick={async () => {
                        try {
                          const result = await checkForUpdates();
                          if (result?.updateAvailable) {
                            if (result.manualOnly && result.manualDownloadUrl) {
                              showConfirmDialog({
                                title: t(
                                  "settingsPage.general.updates.dialogs.manualUpdateAvailable.title"
                                ),
                                description: t(
                                  "settingsPage.general.updates.dialogs.manualUpdateAvailable.description",
                                  {
                                    version:
                                      result.version ||
                                      t("settingsPage.general.updates.newVersion"),
                                  }
                                ),
                                confirmText: t(
                                  "settingsPage.general.updates.dialogs.manualUpdateAvailable.confirmText"
                                ),
                                onConfirm: async () => {
                                  await window.electronAPI.openExternal(result.manualDownloadUrl);
                                },
                              });
                            } else {
                              showConfirmDialog({
                                title: t(
                                  "settingsPage.general.updates.dialogs.updateAvailable.title"
                                ),
                                description: t(
                                  "settingsPage.general.updates.dialogs.updateAvailable.description",
                                  {
                                    version:
                                      result.version ||
                                      t("settingsPage.general.updates.newVersion"),
                                  }
                                ),
                                confirmText: t("settingsPage.general.updates.downloadUpdate", {
                                  version: result.version || "",
                                }),
                                onConfirm: async () => {
                                  try {
                                    await downloadUpdate();
                                  } catch (error: any) {
                                    showAlertDialog({
                                      title: t(
                                        "settingsPage.general.updates.dialogs.downloadFailed.title"
                                      ),
                                      description: t(
                                        "settingsPage.general.updates.dialogs.downloadFailed.description"
                                      ),
                                    });
                                  }
                                },
                              });
                            }
                          } else if (result?.error) {
                            showAlertDialog({
                              title: t("settingsPage.general.updates.dialogs.checkFailed.title"),
                              description: t(
                                "settingsPage.general.updates.dialogs.checkFailed.description",
                                {
                                  message: result.error,
                                }
                              ),
                            });
                          } else {
                            showAlertDialog({
                              title: t("settingsPage.general.updates.dialogs.noUpdates.title"),
                              description: t(
                                "settingsPage.general.updates.dialogs.noUpdates.description"
                              ),
                            });
                          }
                        } catch (error: any) {
                          showAlertDialog({
                            title: t("settingsPage.general.updates.dialogs.noUpdates.title"),
                            description: t("settingsPage.general.updates.dialogs.noUpdates.description"),
                          });
                        }
                      }}
                      disabled={checkingForUpdates || updateStatus.isDevelopment}
                      variant="outline"
                      className="w-full"
                      size="sm"
                    >
                      <RefreshCw
                        size={13}
                        className={`mr-1.5 ${checkingForUpdates ? "animate-spin" : ""}`}
                      />
                      {checkingForUpdates
                        ? t("settingsPage.general.updates.checking")
                        : t("settingsPage.general.updates.checkForUpdates")}
                    </Button>

                    {isUpdateAvailable && !updateStatus.updateDownloaded && (
                      <div className="space-y-2">
                        <Button
                          onClick={async () => {
                            try {
                              if (isManualUpdate && manualUpdateUrl) {
                                await window.electronAPI.openExternal(manualUpdateUrl);
                              } else {
                                await downloadUpdate();
                              }
                            } catch (error: any) {
                              showAlertDialog({
                                title: t(
                                  "settingsPage.general.updates.dialogs.downloadFailed.title"
                                ),
                                description: t(
                                  "settingsPage.general.updates.dialogs.downloadFailed.description"
                                ),
                              });
                            }
                          }}
                          disabled={downloadingUpdate}
                          variant="success"
                          className="w-full"
                          size="sm"
                        >
                          <Download
                            size={13}
                            className={`mr-1.5 ${downloadingUpdate ? "animate-pulse" : ""}`}
                          />
                          {isManualUpdate
                            ? t("settingsPage.general.updates.openReleasePage")
                            : downloadingUpdate
                              ? t("settingsPage.general.updates.downloading", {
                                progress: Math.round(updateDownloadProgress),
                              })
                              : t("settingsPage.general.updates.downloadUpdate", {
                                version: updateInfo?.version || "",
                              })}
                        </Button>

                        {downloadingUpdate && (
                          <div className="h-1 w-full overflow-hidden rounded-full bg-muted/50">
                            <div
                              className="h-full bg-success transition-all duration-200 rounded-full"
                              style={{
                                width: `${Math.min(100, Math.max(0, updateDownloadProgress))}%`,
                              }}
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {updateStatus.updateDownloaded && (
                      <Button
                        onClick={() => {
                          showConfirmDialog({
                            title: t("settingsPage.general.updates.dialogs.installUpdate.title"),
                            description: t(
                              "settingsPage.general.updates.dialogs.installUpdate.description",
                              { version: updateInfo?.version || "" }
                            ),
                            confirmText: t(
                              "settingsPage.general.updates.dialogs.installUpdate.confirmText"
                            ),
                            onConfirm: async () => {
                              try {
                                await installUpdateAction();
                              } catch (error: any) {
                                showAlertDialog({
                                  title: t(
                                    "settingsPage.general.updates.dialogs.installFailed.title"
                                  ),
                                  description: t(
                                    "settingsPage.general.updates.dialogs.installFailed.description"
                                  ),
                                });
                              }
                            },
                          });
                        }}
                        disabled={installInitiated}
                        className="w-full"
                        size="sm"
                      >
                        <RefreshCw
                          size={14}
                          className={`mr-2 ${installInitiated ? "animate-spin" : ""}`}
                        />
                        {installInitiated
                          ? t("settingsPage.general.updates.restarting")
                          : t("settingsPage.general.updates.installAndRestart")}
                      </Button>
                    )}
                  </div>

                  {updateInfo?.releaseNotes && (
                    <div className="mt-4 pt-4 border-t border-border/30">
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                        {t("settingsPage.general.updates.whatsNew", {
                          version: updateInfo.version,
                        })}
                      </p>
                      <div className="text-[12px] text-muted-foreground">
                        <MarkdownRenderer content={updateInfo.releaseNotes} />
                      </div>
                    </div>
                  )}
                </SettingsPanelRow>
              </SettingsPanel>
            </div>

            {/* Appearance */}
            <div>
              <SectionHeader
                title={t("settingsPage.general.appearance.title")}
                description={t("settingsPage.general.appearance.description")}
              />
              <SettingsPanel>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settingsPage.general.appearance.theme")}
                    description={t("settingsPage.general.appearance.themeDescription")}
                  >
                    <div className="inline-flex items-center gap-px p-0.5 bg-muted/60 dark:bg-surface-2 rounded-md">
                      {(
                        [
                          {
                            value: "light",
                            icon: Sun,
                            label: t("settingsPage.general.appearance.light"),
                          },
                          {
                            value: "dark",
                            icon: Moon,
                            label: t("settingsPage.general.appearance.dark"),
                          },
                          {
                            value: "auto",
                            icon: Monitor,
                            label: t("settingsPage.general.appearance.auto"),
                          },
                        ] as const
                      ).map((option) => {
                        const Icon = option.icon;
                        const isSelected = theme === option.value;
                        return (
                          <button
                            key={option.value}
                            onClick={() => setTheme(option.value)}
                            className={`
                              flex items-center gap-1 px-2.5 py-1 rounded-[5px] text-[11px] font-medium
                              transition-all duration-100
                              ${isSelected
                                ? "bg-background dark:bg-surface-raised text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                              }
                            `}
                          >
                            <Icon className={`w-3 h-3 ${isSelected ? "text-primary" : ""}`} />
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </SettingsRow>
                </SettingsPanelRow>
              </SettingsPanel>
            </div>

            {/* Sound Effects */}
            <div>
              <SectionHeader title={t("settingsPage.general.soundEffects.title")} />
              <SettingsPanel>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settingsPage.general.soundEffects.dictationSounds")}
                    description={t("settingsPage.general.soundEffects.dictationSoundsDescription")}
                  >
                    <Toggle checked={audioCuesEnabled} onChange={setAudioCuesEnabled} />
                  </SettingsRow>
                </SettingsPanelRow>
              </SettingsPanel>
            </div>

            {/* Floating Icon */}
            <div>
              <SectionHeader
                title={t("settingsPage.general.floatingIcon.title")}
                description={t("settingsPage.general.floatingIcon.description")}
              />
              <SettingsPanel>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settingsPage.general.floatingIcon.autoHide")}
                    description={t("settingsPage.general.floatingIcon.autoHideDescription")}
                  >
                    <Toggle checked={floatingIconAutoHide} onChange={setFloatingIconAutoHide} />
                  </SettingsRow>
                </SettingsPanelRow>
              </SettingsPanel>
            </div>

            {/* Language */}
            <div>
              <SectionHeader
                title={t("settings.language.sectionTitle")}
                description={t("settings.language.sectionDescription")}
              />
              <SettingsPanel>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settings.language.uiLabel")}
                    description={t("settings.language.uiDescription")}
                  >
                    <LanguageSelector
                      value={uiLanguage}
                      onChange={setUiLanguage}
                      options={UI_LANGUAGE_OPTIONS}
                      className="min-w-32"
                    />
                  </SettingsRow>
                </SettingsPanelRow>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settings.language.transcriptionLabel")}
                    description={t("settings.language.transcriptionDescription")}
                  >
                    <LanguageSelector
                      value={preferredLanguage}
                      onChange={(value) =>
                        updateTranscriptionSettings({ preferredLanguage: value })
                      }
                    />
                  </SettingsRow>
                </SettingsPanelRow>
              </SettingsPanel>
            </div>

            {/* Dictation Hotkey */}
            <div>
              <SectionHeader
                title={t("settingsPage.general.hotkey.title")}
                description={t("settingsPage.general.hotkey.description")}
              />
              <SettingsPanel>
                <SettingsPanelRow>
                  <HotkeyInput
                    value={dictationKey}
                    onChange={async (newHotkey) => {
                      await registerHotkey(newHotkey);
                    }}
                    disabled={isHotkeyRegistering}
                    validate={validateHotkeyForInput}
                  />
                </SettingsPanelRow>

                <SettingsPanelRow>
                  <div className="space-y-2">
                    <p className="text-[11px] font-medium text-muted-foreground/80">
                      {t("settingsPage.general.hotkey.secondary.title")}
                    </p>
                    <HotkeyInput
                      value={dictationKeySecondary}
                      onChange={async (newHotkey) => {
                        await registerSecondaryHotkey(newHotkey);
                      }}
                      disabled={isSecondaryHotkeyRegistering}
                      validate={validateSecondaryHotkeyForInput}
                    />
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[11px] text-muted-foreground/80">
                        {secondaryHotkeyProfile
                          ? t("settingsPage.general.hotkey.secondary.profileSavedState")
                          : t("settingsPage.general.hotkey.secondary.profileUnsavedState")}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={saveCurrentAsSecondaryProfile}
                        className="h-7 px-2 text-[11px]"
                      >
                        {t("settingsPage.general.hotkey.secondary.saveCurrentAsProfile2")}
                      </Button>
                    </div>
                  </div>
                </SettingsPanelRow>

                {!isUsingGnomeHotkeys && (
                  <SettingsPanelRow>
                    <p className="text-[11px] font-medium text-muted-foreground/80 mb-2">
                      {t("settingsPage.general.hotkey.activationMode")}
                    </p>
                    <ActivationModeSelector value={activationMode} onChange={setActivationMode} />
                  </SettingsPanelRow>
                )}
              </SettingsPanel>
            </div>
            
            {/* Local Model Storage */}
            <div>
              <SectionHeader
                title={t("settingsPage.aiModels.localModelStorage")}
                description={t("settingsPage.aiModels.localModelStorageDescription")}
              />
              <SettingsPanel>
                <SettingsPanelRow>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-muted/30 border border-border/50 rounded-md px-2.5 py-1.5 overflow-hidden">
                      <p className="text-[12px] font-mono text-muted-foreground truncate">
                        {localModelsDir || t("common.unknown")}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        const result = await window.electronAPI?.pickModelsDirectory?.(localModelsDir);
                        if (result?.success && result.path) {
                          setLocalModelsDir(result.path);
                        }
                      }}
                    >
                      <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                      {t("settingsPage.aiModels.selectDirectory")}
                    </Button>
                  </div>
                </SettingsPanelRow>
              </SettingsPanel>
            </div>

            {/* Startup */}
            <div>
              <SectionHeader title={t("settingsPage.general.startup.title")} />
              <SettingsPanel>
                {platform !== "linux" && (
                  <SettingsPanelRow>
                    <SettingsRow
                      label={t("settingsPage.general.startup.launchAtLogin")}
                      description={t("settingsPage.general.startup.launchAtLoginDescription")}
                    >
                      <Toggle
                        checked={autoStartEnabled}
                        onChange={(checked: boolean) => handleAutoStartChange(checked)}
                        disabled={autoStartLoading}
                      />
                    </SettingsRow>
                  </SettingsPanelRow>
                )}
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settingsPage.general.startup.autoCheckUpdate")}
                    description={t("settingsPage.general.startup.autoCheckUpdateDescription")}
                  >
                    <Toggle
                      checked={autoCheckUpdateEnabled}
                      onChange={(checked: boolean) => handleAutoCheckUpdateChange(checked)}
                      disabled={autoCheckUpdateLoading}
                    />
                  </SettingsRow>
                </SettingsPanelRow>
              </SettingsPanel>
            </div>

            {/* Microphone */}
            <div>
              <SectionHeader
                title={t("settingsPage.general.microphone.title")}
                description={t("settingsPage.general.microphone.description")}
              />
              <SettingsPanel>
                <SettingsPanelRow>
                  <MicrophoneSettings
                    preferBuiltInMic={preferBuiltInMic}
                    selectedMicDeviceId={selectedMicDeviceId}
                    onPreferBuiltInChange={setPreferBuiltInMic}
                    onDeviceSelect={setSelectedMicDeviceId}
                  />
                </SettingsPanelRow>
              </SettingsPanel>
            </div>
          </div>
        );

      case "transcription":
        return (
          <TranscriptionSection
            isSignedIn={isSignedIn ?? false}
            localModelsDir={localModelsDir}
            cloudTranscriptionMode={cloudTranscriptionMode}
            setCloudTranscriptionMode={setCloudTranscriptionMode}
            useLocalWhisper={useLocalWhisper}
            setUseLocalWhisper={setUseLocalWhisper}
            updateTranscriptionSettings={updateTranscriptionSettings}
            cloudTranscriptionProvider={cloudTranscriptionProvider}
            setCloudTranscriptionProvider={setCloudTranscriptionProvider}
            cloudTranscriptionModel={cloudTranscriptionModel}
            setCloudTranscriptionModel={setCloudTranscriptionModel}
            localTranscriptionProvider={localTranscriptionProvider}
            setLocalTranscriptionProvider={setLocalTranscriptionProvider}
            whisperModel={whisperModel}
            setWhisperModel={setWhisperModel}
            parakeetModel={parakeetModel}
            setParakeetModel={setParakeetModel}
            senseVoiceModelPath={senseVoiceModelPath}
            setSenseVoiceModelPath={setSenseVoiceModelPath}
            senseVoiceBinaryPath={senseVoiceBinaryPath}
            setSenseVoiceBinaryPath={setSenseVoiceBinaryPath}
            paraformerModelPath={paraformerModelPath}
            setParaformerModelPath={setParaformerModelPath}
            paraformerBinaryPath={paraformerBinaryPath}
            setParaformerBinaryPath={setParaformerBinaryPath}
            openaiApiKey={openaiApiKey}
            setOpenaiApiKey={setOpenaiApiKey}
            groqApiKey={groqApiKey}
            setGroqApiKey={setGroqApiKey}
            mistralApiKey={mistralApiKey}
            setMistralApiKey={setMistralApiKey}
            customTranscriptionApiKey={customTranscriptionApiKey}
            setCustomTranscriptionApiKey={setCustomTranscriptionApiKey}
            cloudTranscriptionBaseUrl={cloudTranscriptionBaseUrl}
            setCloudTranscriptionBaseUrl={setCloudTranscriptionBaseUrl}
            toast={toast}
          />
        );

      case "dictionary":
        return (
          <div className="space-y-5">
            <SectionHeader
              title={t("settingsPage.dictionary.title")}
              description={t("settingsPage.dictionary.description")}
            />

            {/* Add Words */}
            <SettingsPanel>
              <SettingsPanelRow>
                <div className="space-y-2">
                  <p className="text-[12px] font-medium text-foreground">
                    {t("settingsPage.dictionary.addWordOrPhrase")}
                  </p>
                  <div className="flex gap-2">
                    <Input
                      placeholder={t("settingsPage.dictionary.placeholder")}
                      value={newDictionaryWord}
                      onChange={(e) => setNewDictionaryWord(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleAddDictionaryWord();
                        }
                      }}
                      className="flex-1 h-8 text-[12px]"
                    />
                    <Button
                      onClick={handleAddDictionaryWord}
                      disabled={!newDictionaryWord.trim()}
                      size="sm"
                      className="h-8"
                    >
                      {t("settingsPage.dictionary.add")}
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground/50">
                    {t("settingsPage.dictionary.pressEnterToAdd")}
                  </p>
                </div>
              </SettingsPanelRow>
            </SettingsPanel>

            {/* Word List */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[12px] font-medium text-foreground">
                  {t("settingsPage.dictionary.yourWords")}
                  {customDictionary.length > 0 && (
                    <span className="ml-1.5 text-muted-foreground/50 font-normal text-[11px]">
                      {customDictionary.length}
                    </span>
                  )}
                </p>
                {customDictionary.length > 0 && (
                  <button
                    onClick={() => {
                      showConfirmDialog({
                        title: t("settingsPage.dictionary.clearDictionaryTitle"),
                        description: t("settingsPage.dictionary.clearDictionaryDescription"),
                        confirmText: t("settingsPage.dictionary.clearAll"),
                        variant: "destructive",
                        onConfirm: () => setCustomDictionary([]),
                      });
                    }}
                    className="text-[10px] text-muted-foreground/40 hover:text-destructive transition-colors"
                  >
                    {t("settingsPage.dictionary.clearAll")}
                  </button>
                )}
              </div>

              {customDictionary.length > 0 ? (
                <SettingsPanel>
                  <SettingsPanelRow>
                    <div className="flex flex-wrap gap-1">
                      {customDictionary.map((word) => (
                        <span
                          key={word}
                          className="group inline-flex items-center gap-0.5 py-0.5 rounded-[5px] text-[11px] border transition-all pl-2 pr-1 bg-primary/5 dark:bg-primary/10 text-foreground border-border/30 dark:border-border-subtle hover:border-destructive/40 hover:bg-destructive/5"
                        >
                          {word}
                          <button
                            onClick={() => handleRemoveDictionaryWord(word)}
                            className="ml-0.5 p-0.5 rounded-sm text-muted-foreground/40 hover:text-destructive transition-colors"
                            title={t("settingsPage.dictionary.removeWord")}
                          >
                            <svg
                              width="9"
                              height="9"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                            >
                              <path d="M18 6L6 18M6 6l12 12" />
                            </svg>
                          </button>
                        </span>
                      ))}
                    </div>
                  </SettingsPanelRow>
                </SettingsPanel>
              ) : (
                <div className="rounded-lg border border-dashed border-border/40 dark:border-border-subtle py-6 flex flex-col items-center justify-center text-center">
                  <p className="text-[11px] text-muted-foreground/50">
                    {t("settingsPage.dictionary.noWords")}
                  </p>
                  <p className="text-[10px] text-muted-foreground/40 mt-0.5">
                    {t("settingsPage.dictionary.wordsAppearHere")}
                  </p>
                </div>
              )}
            </div>

            {/* How it works */}
            <div>
              <SectionHeader title={t("settingsPage.dictionary.howItWorksTitle")} />
              <SettingsPanel>
                <SettingsPanelRow>
                  <p className="text-[12px] text-muted-foreground leading-relaxed">
                    {t("settingsPage.dictionary.howItWorksDescription")}
                  </p>
                </SettingsPanelRow>
                <SettingsPanelRow>
                  <p className="text-[12px] text-muted-foreground leading-relaxed">
                    <span className="font-medium text-foreground">
                      {t("settingsPage.dictionary.tipLabel")}
                    </span>{" "}
                    {t("settingsPage.dictionary.tipDescription")}
                  </p>
                </SettingsPanelRow>
              </SettingsPanel>
            </div>
          </div>
        );

      case "aiModels":
        return (
          <AiModelsSection
            cloudReasoningMode={cloudReasoningMode}
            setCloudReasoningMode={setCloudReasoningMode}
            useReasoningModel={useReasoningModel}
            setUseReasoningModel={setUseReasoningModel}
            reasoningModel={reasoningModel}
            setReasoningModel={setReasoningModel}
            reasoningProvider={reasoningProvider}
            setReasoningProvider={setReasoningProvider}
            cloudReasoningBaseUrl={cloudReasoningBaseUrl}
            setCloudReasoningBaseUrl={setCloudReasoningBaseUrl}
            openaiApiKey={openaiApiKey}
            setOpenaiApiKey={setOpenaiApiKey}
            anthropicApiKey={anthropicApiKey}
            setAnthropicApiKey={setAnthropicApiKey}
            geminiApiKey={geminiApiKey}
            setGeminiApiKey={setGeminiApiKey}
            groqApiKey={groqApiKey}
            setGroqApiKey={setGroqApiKey}
            openrouterApiKey={openrouterApiKey}
            setOpenrouterApiKey={setOpenrouterApiKey}
            customReasoningApiKey={customReasoningApiKey}
            setCustomReasoningApiKey={setCustomReasoningApiKey}
            localModelsDir={localModelsDir}
            setLocalModelsDir={setLocalModelsDir}
            isSignedIn={isSignedIn}
            showAlertDialog={showAlertDialog}
            toast={toast}
          />
        );


      case "prompts":
        return (
          <div className="space-y-5">
            <SectionHeader
              title={t("settingsPage.prompts.title")}
              description={t("settingsPage.prompts.description")}
            />

            <PromptStudio />
          </div>
        );

      case "privacy":
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-foreground mb-2">
                {t("settingsPage.privacy.title")}
              </h3>
              <p className="text-sm text-muted-foreground mb-6">
                {t("settingsPage.privacy.description")}
              </p>
            </div>

            {isSignedIn && (
              <SettingsPanel>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settingsPage.privacy.cloudBackup")}
                    description={t("settingsPage.privacy.cloudBackupDescription")}
                  >
                    <Toggle checked={cloudBackupEnabled} onChange={setCloudBackupEnabled} />
                  </SettingsRow>
                </SettingsPanelRow>
              </SettingsPanel>
            )}

            <SettingsPanel>
              <SettingsPanelRow>
                <SettingsRow
                  label={t("settingsPage.privacy.transcriptionHistory")}
                  description={t("settingsPage.privacy.transcriptionHistoryDescription")}
                >
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-3 text-[11px]"
                      disabled={!onOpenTranscriptionHistory}
                      onClick={() => onOpenTranscriptionHistory?.()}
                    >
                      {t("settingsPage.developer.open")}
                    </Button>
                    <Toggle
                      checked={transcriptionHistoryEnabled}
                      onChange={setTranscriptionHistoryEnabled}
                    />
                  </div>
                </SettingsRow>
              </SettingsPanelRow>
              <SettingsPanelRow>
                <SettingsRow
                  label={t("settingsPage.privacy.usageAnalytics")}
                  description={t("settingsPage.privacy.usageAnalyticsDescription")}
                >
                  <Toggle checked={telemetryEnabled} onChange={setTelemetryEnabled} />
                </SettingsRow>
              </SettingsPanelRow>
            </SettingsPanel>
          </div>
        );

      case "permissions":
        return (
          <div className="space-y-5">
            <SectionHeader
              title={t("settingsPage.permissions.title")}
              description={t("settingsPage.permissions.description")}
            />

            {/* Permission Cards - matching onboarding style */}
            <div className="space-y-3">
              <PermissionCard
                icon={Mic}
                title={t("settingsPage.permissions.microphoneTitle")}
                description={t("settingsPage.permissions.microphoneDescription")}
                granted={permissionsHook.micPermissionGranted}
                onRequest={permissionsHook.requestMicPermission}
                buttonText={t("settingsPage.permissions.test")}
                onOpenSettings={permissionsHook.openMicPrivacySettings}
              />

              {platform === "darwin" && (
                <PermissionCard
                  icon={Shield}
                  title={t("settingsPage.permissions.accessibilityTitle")}
                  description={t("settingsPage.permissions.accessibilityDescription")}
                  granted={permissionsHook.accessibilityPermissionGranted}
                  onRequest={permissionsHook.testAccessibilityPermission}
                  buttonText={t("settingsPage.permissions.testAndGrant")}
                  onOpenSettings={permissionsHook.openAccessibilitySettings}
                />
              )}
            </div>

            {/* Error state for microphone */}
            {!permissionsHook.micPermissionGranted && permissionsHook.micPermissionError && (
              <MicPermissionWarning
                error={permissionsHook.micPermissionError}
                onOpenSoundSettings={permissionsHook.openSoundInputSettings}
                onOpenPrivacySettings={permissionsHook.openMicPrivacySettings}
              />
            )}

            {/* Linux paste tools info */}
            {platform === "linux" &&
              permissionsHook.pasteToolsInfo &&
              !permissionsHook.pasteToolsInfo.available && (
                <PasteToolsInfo
                  pasteToolsInfo={permissionsHook.pasteToolsInfo}
                  isChecking={permissionsHook.isCheckingPasteTools}
                  onCheck={permissionsHook.checkPasteToolsAvailability}
                />
              )}

            {/* Troubleshooting section for macOS */}
            {platform === "darwin" && (
              <div>
                <p className="text-[13px] font-medium text-foreground mb-3">
                  {t("settingsPage.permissions.troubleshootingTitle")}
                </p>
                <SettingsPanel>
                  <SettingsPanelRow>
                    <SettingsRow
                      label={t("settingsPage.permissions.resetAccessibility.label")}
                      description={t("settingsPage.permissions.resetAccessibility.rowDescription")}
                    >
                      <Button
                        onClick={resetAccessibilityPermissions}
                        variant="ghost"
                        size="sm"
                        className="text-foreground/70 hover:text-foreground"
                      >
                        {t("settingsPage.permissions.troubleshoot")}
                      </Button>
                    </SettingsRow>
                  </SettingsPanelRow>
                </SettingsPanel>
              </div>
            )}
          </div>
        );

      case "developer":
        return (
          <div className="space-y-6">
            <DeveloperSection />

            {/* Data Management — moved from General */}
            <div className="border-t border-border/40 pt-8">
              <SectionHeader
                title={t("settingsPage.developer.dataManagementTitle")}
                description={t("settingsPage.developer.dataManagementDescription")}
              />

              <div className="space-y-4">
                <SettingsPanel>
                  <SettingsPanelRow>
                    <SettingsRow
                      label={t("settingsPage.developer.modelCache")}
                      description={cachePathHint}
                    >
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => window.electronAPI?.openWhisperModelsFolder?.()}
                        >
                          <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                          {t("settingsPage.developer.open")}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={handleRemoveModels}
                          disabled={isRemovingModels}
                        >
                          {isRemovingModels
                            ? t("settingsPage.developer.removing")
                            : t("settingsPage.developer.clearCache")}
                        </Button>
                      </div>
                    </SettingsRow>
                  </SettingsPanelRow>
                </SettingsPanel>

                <SettingsPanel>
                  <SettingsPanelRow>
                    <SettingsRow
                      label={t("settingsPage.developer.settingsTransfer.title")}
                      description={t("settingsPage.developer.settingsTransfer.description")}
                    >
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={handleExportSettings}>
                          <Download className="mr-1.5 h-3.5 w-3.5" />
                          {t("settingsPage.developer.settingsTransfer.export")}
                        </Button>
                        <Button variant="outline" size="sm" onClick={handleImportSettings}>
                          <Upload className="mr-1.5 h-3.5 w-3.5" />
                          {t("settingsPage.developer.settingsTransfer.import")}
                        </Button>
                      </div>
                    </SettingsRow>
                  </SettingsPanelRow>
                </SettingsPanel>

                <SettingsPanel>
                  <SettingsPanelRow>
                    <SettingsRow
                      label={t("settingsPage.developer.resetAppData")}
                      description={t("settingsPage.developer.resetAppDataDescription")}
                    >
                      <Button
                        onClick={() => {
                          showConfirmDialog({
                            title: t("settingsPage.developer.resetAll.title"),
                            description: t("settingsPage.developer.resetAll.description"),
                            onConfirm: () => {
                              window.electronAPI
                                ?.cleanupApp()
                                .then(() => {
                                  showAlertDialog({
                                    title: t("settingsPage.developer.resetAll.successTitle"),
                                    description: t(
                                      "settingsPage.developer.resetAll.successDescription"
                                    ),
                                  });
                                  setTimeout(() => {
                                    window.location.reload();
                                  }, 1000);
                                })
                                .catch(() => {
                                  showAlertDialog({
                                    title: t("settingsPage.developer.resetAll.failedTitle"),
                                    description: t(
                                      "settingsPage.developer.resetAll.failedDescription"
                                    ),
                                  });
                                });
                            },
                            variant: "destructive",
                            confirmText: t("settingsPage.developer.resetAll.confirmText"),
                          });
                        }}
                        variant="outline"
                        size="sm"
                        className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:border-destructive"
                      >
                        {t("common.reset")}
                      </Button>
                    </SettingsRow>
                  </SettingsPanelRow>
                </SettingsPanel>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <>
      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => !open && hideConfirmDialog()}
        title={confirmDialog.title}
        description={confirmDialog.description}
        onConfirm={confirmDialog.onConfirm}
        variant={confirmDialog.variant}
        confirmText={confirmDialog.confirmText}
        cancelText={confirmDialog.cancelText}
      />

      <AlertDialog
        open={alertDialog.open}
        onOpenChange={(open) => !open && hideAlertDialog()}
        title={alertDialog.title}
        description={alertDialog.description}
        onOk={() => { }}
      />

      {renderSectionContent()}
    </>
  );
}
