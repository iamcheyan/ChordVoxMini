import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Download, Trash2, Cloud, Lock, X, AlertTriangle, ExternalLink } from "./ui/Icons";
import { ProviderIcon } from "./ui/ProviderIcon";
import { ProviderTabs } from "./ui/ProviderTabs";
import ModelCardList from "./ui/ModelCardList";
import { DownloadProgressBar } from "./ui/DownloadProgressBar";
import ApiKeyInput from "./ui/ApiKeyInput";
import { ConfirmDialog, AlertDialog } from "./ui/dialog";
import { useDialogs } from "../hooks/useDialogs";
import { useModelDownload } from "../hooks/useModelDownload";
import {
  getTranscriptionProviders,
  TranscriptionProviderData,
  WHISPER_MODEL_INFO,
  PARAKEET_MODEL_INFO,
  SENSEVOICE_MODEL_INFO,
  PARAFORMER_MODEL_INFO,
} from "../models/ModelRegistry";
import {
  MODEL_PICKER_COLORS,
  type ColorScheme,
  type ModelPickerStyles,
} from "../utils/modelPickerStyles";
import { getProviderIcon, isMonochromeProvider } from "../utils/providerIcons";
import { API_ENDPOINTS } from "../config/constants";
import { createExternalLinkHandler, openExternalLink } from "../utils/externalLinks";
import { InfoBox } from "./ui/InfoBox";

interface LocalModel {
  model: string;
  size_mb?: number;
  downloaded?: boolean;
  modelPath?: string;
  path?: string;
}

interface LocalModelCardProps {
  modelId: string;
  name: string;
  description: string;
  size: string;
  actualSizeMb?: number;
  isSelected: boolean;
  isDownloaded: boolean;
  isDownloading: boolean;
  isCancelling: boolean;
  recommended?: boolean;
  provider: string;
  languageLabel?: string;
  onSelect: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onCancel: () => void;
  styles: ModelPickerStyles;
  modelPath?: string;
}

function LocalModelCard({
  modelId,
  name,
  description,
  size,
  actualSizeMb,
  isSelected,
  isDownloaded,
  isDownloading,
  isCancelling,
  recommended,
  provider,
  languageLabel,
  onSelect,
  onDelete,
  onDownload,
  onCancel,
  styles: cardStyles,
  modelPath,
}: LocalModelCardProps) {
  const { t } = useTranslation();
  const handleClick = () => {
    if (isDownloaded && !isSelected) {
      onSelect();
    }
  };

  return (
    <div
      onClick={handleClick}
      className={`relative w-full text-left overflow-hidden rounded-md border transition-all duration-200 group ${
        isSelected ? cardStyles.modelCard.selected : cardStyles.modelCard.default
      } ${isDownloaded && !isSelected ? "cursor-pointer" : ""}`}
    >
      {isSelected && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-linear-to-b from-primary via-primary to-primary/80 rounded-l-md" />
      )}
      <div className="flex items-center gap-1.5 p-2 pl-2.5">
        <div className="shrink-0">
          {isDownloaded ? (
            <div
              className={`w-1.5 h-1.5 rounded-full ${
                isSelected
                  ? "bg-primary shadow-[0_0_6px_oklch(0.62_0.22_260/0.6)] animate-[pulse-glow_2s_ease-in-out_infinite]"
                  : "bg-success shadow-[0_0_4px_rgba(34,197,94,0.5)]"
              }`}
            />
          ) : isDownloading ? (
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_4px_rgba(245,158,11,0.5)] animate-[spinner-rotate_1s_linear_infinite]" />
          ) : (
            <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/20" />
          )}
        </div>

        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <ProviderIcon provider={provider} className="w-3.5 h-3.5 shrink-0" />
          <span className="font-semibold text-sm text-foreground truncate tracking-tight">
            {name}
          </span>
          <span className="text-[11px] text-muted-foreground/50 tabular-nums shrink-0">
            {actualSizeMb ? `${actualSizeMb}MB` : size}
          </span>
          {recommended && (
            <span className={cardStyles.badges.recommended}>{t("common.recommended")}</span>
          )}
          {languageLabel && (
            <span className="text-[11px] text-muted-foreground/50 font-medium shrink-0">
              {languageLabel}
            </span>
          )}
        </div>

        {isDownloaded && modelPath && (
          <div className="px-2.5 pb-2 -mt-0.5">
            <div className="text-[10px] text-muted-foreground/40 font-mono truncate bg-muted/30 px-1.5 py-0.5 rounded-sm border border-border/20">
              {modelPath}
            </div>
          </div>
        )}

        <div className="flex items-center gap-1.5 shrink-0">
          {isDownloaded ? (
            <>
              {isSelected && (
                <span className="text-[10px] font-medium text-primary px-2 py-0.5 bg-primary/10 rounded-sm">
                  {t("common.active")}
                </span>
              )}
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 text-muted-foreground/40 hover:text-destructive opacity-0 group-hover:opacity-100 transition-all active:scale-95"
              >
                <Trash2 size={12} />
              </Button>
            </>
          ) : isDownloading ? (
            <Button
              onClick={(e) => {
                e.stopPropagation();
                onCancel();
              }}
              disabled={isCancelling}
              size="sm"
              variant="outline"
              className="h-6 px-2.5 text-[11px] text-destructive border-destructive/25 hover:bg-destructive/8"
            >
              <X size={11} className="mr-0.5" />
              {isCancelling ? "..." : t("common.cancel")}
            </Button>
          ) : (
            <Button
              onClick={(e) => {
                e.stopPropagation();
                onDownload();
              }}
              size="sm"
              variant="default"
              className="h-6 px-2.5 text-[11px]"
            >
              <Download size={11} className="mr-1" />
              {t("common.download")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

interface TranscriptionModelPickerProps {
  selectedCloudProvider: string;
  onCloudProviderSelect: (providerId: string) => void;
  selectedCloudModel: string;
  onCloudModelSelect: (modelId: string) => void;
  selectedLocalModel: string;
  onLocalModelSelect: (modelId: string, providerId?: string) => void;
  selectedLocalProvider?: string;
  onLocalProviderSelect?: (providerId: string) => void;
  useLocalWhisper: boolean;
  onModeChange: (useLocal: boolean) => void;
  senseVoiceModelPath?: string;
  setSenseVoiceModelPath?: (path: string) => void;
  senseVoiceBinaryPath?: string;
  setSenseVoiceBinaryPath?: (path: string) => void;
  paraformerModelPath?: string;
  setParaformerModelPath?: (path: string) => void;
  paraformerBinaryPath?: string;
  setParaformerBinaryPath?: (path: string) => void;
  openaiApiKey: string;
  setOpenaiApiKey: (key: string) => void;
  groqApiKey: string;
  setGroqApiKey: (key: string) => void;
  mistralApiKey: string;
  setMistralApiKey: (key: string) => void;
  customTranscriptionApiKey?: string;
  setCustomTranscriptionApiKey?: (key: string) => void;
  cloudTranscriptionBaseUrl?: string;
  setCloudTranscriptionBaseUrl?: (url: string) => void;
  className?: string;
  variant?: "onboarding" | "settings";
}

const CLOUD_PROVIDER_TABS = [
  { id: "openai", name: "OpenAI" },
  { id: "groq", name: "Groq", recommended: true },
  { id: "mistral", name: "Mistral" },
  { id: "custom", name: "Custom" },
];

const VALID_CLOUD_PROVIDER_IDS = CLOUD_PROVIDER_TABS.map((p) => p.id);

const LOCAL_PROVIDER_TABS: Array<{ id: string; name: string; disabled?: boolean }> = [
  { id: "whisper", name: "OpenAI Whisper" },
  { id: "nvidia", name: "NVIDIA Parakeet" },
  { id: "sensevoice", name: "SenseVoice" },
  { id: "paraformer", name: "Paraformer" },
];

function isLikelyPathInput(value: string) {
  const raw = String(value || "").trim();
  return raw.includes("/") || raw.includes("\\");
}

interface ModeToggleProps {
  useLocalWhisper: boolean;
  onModeChange: (useLocal: boolean) => void;
}

function ModeToggle({ useLocalWhisper, onModeChange }: ModeToggleProps) {
  const { t } = useTranslation();
  return (
    <div className="relative flex p-0.5 rounded-lg bg-surface-1/80 backdrop-blur-xl dark:bg-surface-1 border border-border/60 dark:border-white/8 shadow-(--shadow-metallic-light) dark:shadow-(--shadow-metallic-dark)">
      <div
        className={`absolute top-0.5 bottom-0.5 w-[calc(50%-2px)] rounded-md bg-card border border-border/60 dark:border-border-subtle shadow-(--shadow-metallic-light) dark:shadow-(--shadow-metallic-dark) transition-transform duration-200 ease-out ${
          useLocalWhisper ? "translate-x-[calc(100%)]" : "translate-x-0"
        }`}
      />
      <button
        onClick={() => onModeChange(false)}
        className={`relative z-10 flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md transition-colors duration-150 ${
          !useLocalWhisper ? "text-foreground" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Cloud className="w-3.5 h-3.5" />
        <span className="text-xs font-medium">{t("common.cloud")}</span>
      </button>
      <button
        onClick={() => onModeChange(true)}
        className={`relative z-10 flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md transition-colors duration-150 ${
          useLocalWhisper ? "text-foreground" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Lock className="w-3.5 h-3.5" />
        <span className="text-xs font-medium">{t("common.local")}</span>
      </button>
    </div>
  );
}

export default function TranscriptionModelPicker({
  selectedCloudProvider,
  onCloudProviderSelect,
  selectedCloudModel,
  onCloudModelSelect,
  selectedLocalModel,
  onLocalModelSelect,
  selectedLocalProvider = "whisper",
  onLocalProviderSelect,
  useLocalWhisper,
  onModeChange,
  senseVoiceModelPath = "",
  setSenseVoiceModelPath,
  senseVoiceBinaryPath = "",
  setSenseVoiceBinaryPath,
  paraformerModelPath = "",
  setParaformerModelPath,
  paraformerBinaryPath = "",
  setParaformerBinaryPath,
  openaiApiKey,
  setOpenaiApiKey,
  groqApiKey,
  setGroqApiKey,
  mistralApiKey,
  setMistralApiKey,
  customTranscriptionApiKey = "",
  setCustomTranscriptionApiKey,
  cloudTranscriptionBaseUrl = "",
  setCloudTranscriptionBaseUrl,
  className = "",
  variant = "settings",
}: TranscriptionModelPickerProps) {
  const { t } = useTranslation();
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [parakeetModels, setParakeetModels] = useState<LocalModel[]>([]);
  const [senseVoiceModels, setSenseVoiceModels] = useState<LocalModel[]>([]);
  const [paraformerModels, setParaformerModels] = useState<LocalModel[]>([]);
  const [senseVoiceBinaryStatus, setSenseVoiceBinaryStatus] = useState<
    "checking" | "installed" | "missing"
  >("checking");
  const [paraformerBinaryStatus, setParaformerBinaryStatus] = useState<
    "checking" | "installed" | "missing"
  >("checking");
  const [isDownloadingParaformerBinary, setIsDownloadingParaformerBinary] = useState(false);
  const [paraformerBinaryDownloadProgress, setParaformerBinaryDownloadProgress] = useState(0);
  const [isDownloadingSenseVoiceBinary, setIsDownloadingSenseVoiceBinary] = useState(false);
  const [senseVoiceBinaryDownloadProgress, setSenseVoiceBinaryDownloadProgress] = useState(0);
  const [internalLocalProvider, setInternalLocalProvider] = useState(selectedLocalProvider);
  const hasLoadedRef = useRef(false);
  const hasLoadedParakeetRef = useRef(false);
  const hasLoadedSenseVoiceRef = useRef(false);
  const hasLoadedParaformerRef = useRef(false);

  useEffect(() => {
    if (selectedLocalProvider !== internalLocalProvider) {
      setInternalLocalProvider(selectedLocalProvider);
    }
  }, [selectedLocalProvider]);
  const isLoadingRef = useRef(false);
  const isLoadingParakeetRef = useRef(false);
  const isLoadingSenseVoiceRef = useRef(false);
  const isLoadingParaformerRef = useRef(false);
  const loadLocalModelsRef = useRef<(() => Promise<void>) | null>(null);
  const loadParakeetModelsRef = useRef<(() => Promise<void>) | null>(null);
  const loadSenseVoiceModelsRef = useRef<(() => Promise<void>) | null>(null);
  const loadParaformerModelsRef = useRef<(() => Promise<void>) | null>(null);
  const ensureValidCloudSelectionRef = useRef<(() => void) | null>(null);
  const selectedLocalModelRef = useRef(selectedLocalModel);
  const onLocalModelSelectRef = useRef(onLocalModelSelect);

  const { confirmDialog, showConfirmDialog, hideConfirmDialog } = useDialogs();
  const colorScheme: ColorScheme = variant === "settings" ? "purple" : "blue";
  const styles = useMemo(() => MODEL_PICKER_COLORS[colorScheme], [colorScheme]);
  const cloudProviders = useMemo(() => getTranscriptionProviders(), []);
  const cloudProviderTabs = CLOUD_PROVIDER_TABS.map((provider) =>
    provider.id === "custom" ? { ...provider, name: t("transcription.customProvider") } : provider
  );

  useEffect(() => {
    selectedLocalModelRef.current = selectedLocalModel;
  }, [selectedLocalModel]);
  useEffect(() => {
    onLocalModelSelectRef.current = onLocalModelSelect;
  }, [onLocalModelSelect]);

  const validateAndSelectModel = useCallback((loadedModels: LocalModel[]) => {
    const current = selectedLocalModelRef.current;
    if (!current) return;
    if (isLikelyPathInput(current)) return;

    const downloaded = loadedModels.filter((m) => m.downloaded);
    const isCurrentDownloaded = loadedModels.find((m) => m.model === current)?.downloaded;

    if (!isCurrentDownloaded && downloaded.length > 0) {
      onLocalModelSelectRef.current(downloaded[0].model, "whisper");
    } else if (!isCurrentDownloaded && downloaded.length === 0) {
      onLocalModelSelectRef.current("", "whisper");
    }
  }, []);

  const loadLocalModels = useCallback(async () => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;

    try {
      const result = await window.electronAPI?.listWhisperModels();
      if (result?.success) {
        setLocalModels(result.models);
        validateAndSelectModel(result.models);
      }
    } catch (error) {
      console.error("[TranscriptionModelPicker] Failed to load models:", error);
      setLocalModels([]);
    } finally {
      isLoadingRef.current = false;
    }
  }, [validateAndSelectModel]);

  const loadParakeetModels = useCallback(async () => {
    if (isLoadingParakeetRef.current) return;
    isLoadingParakeetRef.current = true;

    try {
      const result = await window.electronAPI?.listParakeetModels();
      if (result?.success) {
        setParakeetModels(result.models);
      }
    } catch (error) {
      console.error("[TranscriptionModelPicker] Failed to load Parakeet models:", error);
      setParakeetModels([]);
    } finally {
      isLoadingParakeetRef.current = false;
    }
  }, []);

  const loadSenseVoiceModels = useCallback(async () => {
    if (isLoadingSenseVoiceRef.current) return;
    isLoadingSenseVoiceRef.current = true;

    try {
      const result = await window.electronAPI?.listSenseVoiceModels();
      if (result?.success) {
        setSenseVoiceModels(result.models);
      }
    } catch (error) {
      console.error("[TranscriptionModelPicker] Failed to load SenseVoice models:", error);
      setSenseVoiceModels([]);
    } finally {
      isLoadingSenseVoiceRef.current = false;
    }
  }, []);

  const loadParaformerModels = useCallback(async () => {
    if (isLoadingParaformerRef.current) return;
    isLoadingParaformerRef.current = true;

    try {
      const result = await window.electronAPI?.listParaformerModels();
      if (result?.success) {
        setParaformerModels(result.models);
      }
    } catch (error) {
      console.error("[TranscriptionModelPicker] Failed to load Paraformer models:", error);
      setParaformerModels([]);
    } finally {
      isLoadingParaformerRef.current = false;
    }
  }, []);

  const ensureValidCloudSelection = useCallback(() => {
    const isValidProvider = VALID_CLOUD_PROVIDER_IDS.includes(selectedCloudProvider);

    if (!isValidProvider) {
      const knownProviderUrls = cloudProviders.map((p) => p.baseUrl);
      const hasCustomUrl =
        cloudTranscriptionBaseUrl &&
        cloudTranscriptionBaseUrl.trim() !== "" &&
        cloudTranscriptionBaseUrl !== API_ENDPOINTS.TRANSCRIPTION_BASE &&
        !knownProviderUrls.includes(cloudTranscriptionBaseUrl);

      if (hasCustomUrl) {
        onCloudProviderSelect("custom");
      } else {
        const firstProvider = cloudProviders[0];
        if (firstProvider) {
          onCloudProviderSelect(firstProvider.id);
          if (firstProvider.models?.length) {
            onCloudModelSelect(firstProvider.models[0].id);
          }
        }
      }
    } else if (selectedCloudProvider !== "custom" && !selectedCloudModel) {
      const provider = cloudProviders.find((p) => p.id === selectedCloudProvider);
      if (provider?.models?.length) {
        onCloudModelSelect(provider.models[0].id);
      }
    }
  }, [
    cloudProviders,
    cloudTranscriptionBaseUrl,
    selectedCloudProvider,
    selectedCloudModel,
    onCloudProviderSelect,
    onCloudModelSelect,
  ]);

  useEffect(() => {
    loadLocalModelsRef.current = loadLocalModels;
  }, [loadLocalModels]);
  useEffect(() => {
    loadParakeetModelsRef.current = loadParakeetModels;
  }, [loadParakeetModels]);
  useEffect(() => {
    loadSenseVoiceModelsRef.current = loadSenseVoiceModels;
  }, [loadSenseVoiceModels]);
  useEffect(() => {
    loadParaformerModelsRef.current = loadParaformerModels;
  }, [loadParaformerModels]);
  useEffect(() => {
    ensureValidCloudSelectionRef.current = ensureValidCloudSelection;
  }, [ensureValidCloudSelection]);

  useEffect(() => {
    if (!useLocalWhisper) return;

    if (internalLocalProvider === "whisper" && !hasLoadedRef.current) {
      hasLoadedRef.current = true;
      loadLocalModelsRef.current?.();
    } else if (internalLocalProvider === "nvidia" && !hasLoadedParakeetRef.current) {
      hasLoadedParakeetRef.current = true;
      loadParakeetModelsRef.current?.();
    } else if (internalLocalProvider === "sensevoice" && !hasLoadedSenseVoiceRef.current) {
      hasLoadedSenseVoiceRef.current = true;
      loadSenseVoiceModelsRef.current?.();
    } else if (internalLocalProvider === "paraformer" && !hasLoadedParaformerRef.current) {
      hasLoadedParaformerRef.current = true;
      loadParaformerModelsRef.current?.();
    }
  }, [useLocalWhisper, internalLocalProvider]);

  useEffect(() => {
    if (!useLocalWhisper || internalLocalProvider !== "sensevoice") {
      setSenseVoiceBinaryStatus("checking");
      return;
    }

    let cancelled = false;
    setSenseVoiceBinaryStatus("checking");

    const check = async () => {
      try {
        const result = await window.electronAPI?.checkSenseVoiceInstallation?.(
          senseVoiceBinaryPath || ""
        );
        if (cancelled) return;
        setSenseVoiceBinaryStatus(
          result?.installed && result?.working ? "installed" : "missing"
        );
      } catch {
        if (!cancelled) setSenseVoiceBinaryStatus("missing");
      }
    };

    check();
    return () => {
      cancelled = true;
    };
  }, [useLocalWhisper, internalLocalProvider, senseVoiceBinaryPath]);

  // Paraformer binary status check
  useEffect(() => {
    if (!useLocalWhisper || internalLocalProvider !== "paraformer") {
      setParaformerBinaryStatus("checking");
      return;
    }

    let cancelled = false;
    setParaformerBinaryStatus("checking");

    const check = async () => {
      try {
        const result = await window.electronAPI?.checkParaformerBinaryStatus?.();
        if (cancelled) return;
        setParaformerBinaryStatus(result?.installed ? "installed" : "missing");
      } catch {
        if (!cancelled) setParaformerBinaryStatus("missing");
      }
    };

    check();
    return () => {
      cancelled = true;
    };
  }, [useLocalWhisper, internalLocalProvider]);

  // Paraformer binary download progress listener
  useEffect(() => {
    if (!useLocalWhisper || internalLocalProvider !== "paraformer") return;

    const dispose = window.electronAPI?.onParaformerBinaryDownloadProgress?.(
      (_event: unknown, data: { type: string; percentage: number }) => {
        if (data.type === "complete") {
          setIsDownloadingParaformerBinary(false);
          setParaformerBinaryDownloadProgress(0);
          window.electronAPI?.checkParaformerBinaryStatus?.().then((result) => {
            setParaformerBinaryStatus(result?.installed ? "installed" : "missing");
          });
        } else if (data.type === "error") {
          setIsDownloadingParaformerBinary(false);
          setParaformerBinaryDownloadProgress(0);
        } else {
          setParaformerBinaryDownloadProgress(data.percentage);
        }
      }
    );

    return () => {
      dispose?.();
    };
  }, [useLocalWhisper, internalLocalProvider]);

  const handleDownloadParaformerBinary = useCallback(async () => {
    if (isDownloadingParaformerBinary) return;
    setIsDownloadingParaformerBinary(true);
    setParaformerBinaryDownloadProgress(0);
    try {
      const result = await window.electronAPI?.downloadParaformerBinary?.();
      if (!result?.success) {
        console.error("[TranscriptionModelPicker] Failed to download Paraformer binary:", result?.error);
      }
    } catch (error) {
      console.error("[TranscriptionModelPicker] Failed to download Paraformer binary:", error);
    }
  }, [isDownloadingParaformerBinary]);

  // SenseVoice binary download progress listener
  useEffect(() => {
    if (!useLocalWhisper || internalLocalProvider !== "sensevoice") return;

    const dispose = window.electronAPI?.onSenseVoiceBinaryDownloadProgress?.(
      (_event: unknown, data: { type: string; percentage: number; message?: string }) => {
        if (data.type === "complete") {
          setIsDownloadingSenseVoiceBinary(false);
          setSenseVoiceBinaryDownloadProgress(0);
          window.electronAPI?.checkSenseVoiceBinaryStatus?.().then((result) => {
            setSenseVoiceBinaryStatus(result?.installed ? "installed" : "missing");
          });
        } else if (data.type === "error") {
          setIsDownloadingSenseVoiceBinary(false);
          setSenseVoiceBinaryDownloadProgress(0);
        } else {
          setSenseVoiceBinaryDownloadProgress(data.percentage);
        }
      }
    );

    return () => {
      dispose?.();
    };
  }, [useLocalWhisper, internalLocalProvider]);

  const handleDownloadSenseVoiceBinary = useCallback(async () => {
    if (isDownloadingSenseVoiceBinary) return;
    setIsDownloadingSenseVoiceBinary(true);
    setSenseVoiceBinaryDownloadProgress(0);
    try {
      const result = await window.electronAPI?.downloadSenseVoiceBinary?.();
      if (!result?.success) {
        console.error("[TranscriptionModelPicker] Failed to download SenseVoice binary:", result?.error);
      }
    } catch (error) {
      console.error("[TranscriptionModelPicker] Failed to download SenseVoice binary:", error);
    }
  }, [isDownloadingSenseVoiceBinary]);

  useEffect(() => {
    if (useLocalWhisper) return;

    hasLoadedRef.current = false;
    hasLoadedParakeetRef.current = false;
    hasLoadedSenseVoiceRef.current = false;
    hasLoadedParaformerRef.current = false;
    ensureValidCloudSelectionRef.current?.();
  }, [useLocalWhisper]);

  useEffect(() => {
    const handleModelsCleared = () => {
      loadLocalModels();
      loadParakeetModels();
      loadSenseVoiceModels();
      loadParaformerModels();
    };
    window.addEventListener("local-models-cleared", handleModelsCleared);
    return () => window.removeEventListener("local-models-cleared", handleModelsCleared);
  }, [loadLocalModels, loadParakeetModels, loadSenseVoiceModels]);

  const {
    downloadingModel,
    downloadProgress,
    downloadModel,
    deleteModel,
    isDownloadingModel,
    isInstalling,
    cancelDownload,
    isCancelling,
    alertDialog: whisperAlertDialog,
    hideAlertDialog: hideWhisperAlertDialog,
  } = useModelDownload({
    modelType: "whisper",
    onDownloadComplete: loadLocalModels,
  });

  const {
    downloadingModel: downloadingParakeetModel,
    downloadProgress: parakeetDownloadProgress,
    downloadModel: downloadParakeetModel,
    deleteModel: deleteParakeetModel,
    isDownloadingModel: isDownloadingParakeetModel,
    isInstalling: isInstallingParakeet,
    cancelDownload: cancelParakeetDownload,
    isCancelling: isCancellingParakeet,
    alertDialog: parakeetAlertDialog,
    hideAlertDialog: hideParakeetAlertDialog,
  } = useModelDownload({
    modelType: "parakeet",
    onDownloadComplete: loadParakeetModels,
  });

  const {
    downloadingModel: downloadingSenseVoiceModel,
    downloadProgress: senseVoiceDownloadProgress,
    downloadModel: downloadSenseVoiceModel,
    deleteModel: deleteSenseVoiceModel,
    isDownloadingModel: isDownloadingSenseVoiceModel,
    isInstalling: isInstallingSenseVoice,
    cancelDownload: cancelSenseVoiceDownload,
    isCancelling: isCancellingSenseVoice,
    alertDialog: senseVoiceAlertDialog,
    hideAlertDialog: hideSenseVoiceAlertDialog,
  } = useModelDownload({
    modelType: "sensevoice",
    onDownloadComplete: loadSenseVoiceModels,
  });

  const {
    downloadingModel: downloadingParaformerModel,
    downloadProgress: paraformerDownloadProgress,
    downloadModel: downloadParaformerModel,
    deleteModel: deleteParaformerModel,
    isDownloadingModel: isDownloadingParaformerModel,
    isInstalling: isInstallingParaformer,
    cancelDownload: cancelParaformerDownload,
    isCancelling: isCancellingParaformer,
    alertDialog: paraformerAlertDialog,
    hideAlertDialog: hideParaformerAlertDialog,
  } = useModelDownload({
    modelType: "paraformer",
    onDownloadComplete: loadParaformerModels,
  });

  const handleModeChange = useCallback(
    (isLocal: boolean) => {
      onModeChange(isLocal);
      if (!isLocal) ensureValidCloudSelection();
    },
    [onModeChange, ensureValidCloudSelection]
  );

  const handleCloudProviderChange = useCallback(
    (providerId: string) => {
      onCloudProviderSelect(providerId);
      const provider = cloudProviders.find((p) => p.id === providerId);

      if (providerId === "custom") {
        onCloudModelSelect("whisper-1");
        return;
      }

      if (provider) {
        setCloudTranscriptionBaseUrl?.(provider.baseUrl);
        if (provider.models?.length) {
          onCloudModelSelect(provider.models[0].id);
        }
      }
    },
    [cloudProviders, onCloudProviderSelect, onCloudModelSelect, setCloudTranscriptionBaseUrl]
  );

  const handleLocalProviderChange = useCallback(
    (providerId: string) => {
      const tab = LOCAL_PROVIDER_TABS.find((t) => t.id === providerId);
      if (tab?.disabled) return;
      setInternalLocalProvider(providerId);
      onLocalProviderSelect?.(providerId);
    },
    [onLocalProviderSelect]
  );

  const handleWhisperModelSelect = useCallback(
    (modelId: string) => {
      onLocalProviderSelect?.("whisper");
      setInternalLocalProvider("whisper");
      onLocalModelSelect(modelId, "whisper");
    },
    [onLocalModelSelect, onLocalProviderSelect]
  );

  const handleParakeetModelSelect = useCallback(
    (modelId: string) => {
      onLocalProviderSelect?.("nvidia");
      setInternalLocalProvider("nvidia");
      onLocalModelSelect(modelId, "nvidia");
    },
    [onLocalModelSelect, onLocalProviderSelect]
  );

  const selectedWhisperModelId = useMemo(() => {
    const rawValue = String(selectedLocalModel || "").trim();
    if (!rawValue || isLikelyPathInput(rawValue)) {
      const normalizedPath = rawValue.toLowerCase();
      if (!normalizedPath) return "";
      const byPath = localModels.find(
        (model) => String(model.path || "").trim().toLowerCase() === normalizedPath
      );
      return byPath?.model || "";
    }
    return rawValue;
  }, [selectedLocalModel, localModels]);

  const selectedWhisperModelPath = useMemo(() => {
    const rawValue = String(selectedLocalModel || "").trim();
    if (isLikelyPathInput(rawValue)) {
      return rawValue;
    }
    const selected = localModels.find((model) => model.model === rawValue);
    return selected?.path || "";
  }, [selectedLocalModel, localModels]);

  const handleWhisperModelPathChange = useCallback(
    (value: string) => {
      onLocalProviderSelect?.("whisper");
      setInternalLocalProvider("whisper");
      onLocalModelSelect(value, "whisper");
    },
    [onLocalModelSelect, onLocalProviderSelect]
  );

  const handlePickWhisperModel = useCallback(async () => {
    try {
      const result = await window.electronAPI?.pickWhisperModelFile?.(selectedWhisperModelPath);
      if (result?.success && result.path) {
        handleWhisperModelPathChange(result.path);
      }
    } catch (error) {
      console.error("[TranscriptionModelPicker] Failed to pick Whisper model:", error);
    }
  }, [selectedWhisperModelPath, handleWhisperModelPathChange]);

  const selectedParakeetModelId = useMemo(() => {
    const rawValue = String(selectedLocalModel || "").trim();
    if (!rawValue || isLikelyPathInput(rawValue)) {
      const normalizedPath = rawValue.toLowerCase();
      if (!normalizedPath) return "";
      const byPath = parakeetModels.find(
        (model) => String(model.path || "").trim().toLowerCase() === normalizedPath
      );
      return byPath?.model || "";
    }
    return rawValue;
  }, [selectedLocalModel, parakeetModels]);

  const selectedParakeetModelPath = useMemo(() => {
    const rawValue = String(selectedLocalModel || "").trim();
    if (isLikelyPathInput(rawValue)) {
      return rawValue;
    }
    const selected = parakeetModels.find((model) => model.model === rawValue);
    return selected?.path || "";
  }, [selectedLocalModel, parakeetModels]);

  const handleParakeetModelPathChange = useCallback(
    (value: string) => {
      onLocalProviderSelect?.("nvidia");
      setInternalLocalProvider("nvidia");
      onLocalModelSelect(value, "nvidia");
    },
    [onLocalModelSelect, onLocalProviderSelect]
  );

  const handlePickParakeetModelDirectory = useCallback(async () => {
    try {
      const result = await window.electronAPI?.pickParakeetModelDirectory?.(
        selectedParakeetModelPath
      );
      if (result?.success && result.path) {
        handleParakeetModelPathChange(result.path);
      }
    } catch (error) {
      console.error("[TranscriptionModelPicker] Failed to pick Parakeet model directory:", error);
    }
  }, [selectedParakeetModelPath, handleParakeetModelPathChange]);

  const selectedSenseVoiceModelId = useMemo(() => {
    const currentPath = String(senseVoiceModelPath || "").trim().toLowerCase();
    if (!currentPath) return "";

    const fromLoaded = senseVoiceModels.find((model) => {
      const candidatePath = String(model.modelPath || model.path || "")
        .trim()
        .toLowerCase();
      return candidatePath && candidatePath === currentPath;
    });
    if (fromLoaded?.model) return fromLoaded.model;

    const fileName = currentPath.split(/[\\/]/).pop() || "";
    for (const [modelId, info] of Object.entries(SENSEVOICE_MODEL_INFO)) {
      if (info.fileName.toLowerCase() === fileName) {
        return modelId;
      }
    }
    return "";
  }, [senseVoiceModelPath, senseVoiceModels]);

  const handleSenseVoiceModelPathChange = useCallback(
    (value: string) => {
      setSenseVoiceModelPath?.(value);
      onLocalProviderSelect?.("sensevoice");
      setInternalLocalProvider("sensevoice");
      onLocalModelSelect(value, "sensevoice");
    },
    [onLocalModelSelect, onLocalProviderSelect, setSenseVoiceModelPath]
  );

  const handleSenseVoiceModelSelect = useCallback(
    async (modelId: string) => {
      onLocalProviderSelect?.("sensevoice");
      setInternalLocalProvider("sensevoice");

      try {
        const status = await window.electronAPI?.checkSenseVoiceModelStatus(modelId);
        if (status?.downloaded && status.modelPath) {
          handleSenseVoiceModelPathChange(status.modelPath);
          return;
        }
      } catch (error) {
        console.error("[TranscriptionModelPicker] Failed to resolve SenseVoice model path:", error);
      }

      const fallback = senseVoiceModels.find((model) => model.model === modelId);
      const fallbackPath = fallback?.modelPath || fallback?.path || "";
      if (fallbackPath) {
        handleSenseVoiceModelPathChange(fallbackPath);
      }
    },
    [handleSenseVoiceModelPathChange, onLocalProviderSelect, senseVoiceModels]
  );

  const handleSenseVoiceBinaryPathChange = useCallback(
    (value: string) => {
      setSenseVoiceBinaryPath?.(value);
      onLocalProviderSelect?.("sensevoice");
      setInternalLocalProvider("sensevoice");
    },
    [onLocalProviderSelect, setSenseVoiceBinaryPath]
  );

  const handlePickSenseVoiceModel = useCallback(async () => {
    try {
      const result = await window.electronAPI?.pickSenseVoiceModelFile?.(senseVoiceModelPath);
      if (result?.success && result.path) {
        handleSenseVoiceModelPathChange(result.path);
      }
    } catch (error) {
      console.error("[TranscriptionModelPicker] Failed to pick SenseVoice model:", error);
    }
  }, [senseVoiceModelPath, handleSenseVoiceModelPathChange]);

  const handlePickSenseVoiceBinary = useCallback(async () => {
    try {
      const result = await window.electronAPI?.pickSenseVoiceBinary?.(senseVoiceBinaryPath);
      if (result?.success && result.path) {
        handleSenseVoiceBinaryPathChange(result.path);
      }
    } catch (error) {
      console.error("[TranscriptionModelPicker] Failed to pick SenseVoice binary:", error);
    }
  }, [senseVoiceBinaryPath, handleSenseVoiceBinaryPathChange]);

  const selectedParaformerModelId = useMemo(() => {
    const currentPath = String(paraformerModelPath || "").trim().toLowerCase();
    if (!currentPath) return "";

    const fromLoaded = paraformerModels.find((model) => {
      const candidatePath = String(model.modelPath || model.path || "")
        .trim()
        .toLowerCase();
      return candidatePath && candidatePath === currentPath;
    });
    if (fromLoaded?.model) return fromLoaded.model;

    return "";
  }, [paraformerModelPath, paraformerModels]);

  const handleParaformerModelPathChange = useCallback(
    (value: string) => {
      setParaformerModelPath?.(value);
      onLocalProviderSelect?.("paraformer");
      setInternalLocalProvider("paraformer");
      onLocalModelSelect(value, "paraformer");
    },
    [onLocalModelSelect, onLocalProviderSelect, setParaformerModelPath]
  );

  const handleParaformerModelSelect = useCallback(
    async (modelId: string) => {
      onLocalProviderSelect?.("paraformer");
      setInternalLocalProvider("paraformer");

      try {
        const status = await window.electronAPI?.checkParaformerModelStatus(modelId);
        if (status?.downloaded && status.modelPath) {
          handleParaformerModelPathChange(status.modelPath);
          return;
        }
      } catch (error) {
        console.error("[TranscriptionModelPicker] Failed to resolve Paraformer model path:", error);
      }

      const fallback = paraformerModels.find((model) => model.model === modelId);
      const fallbackPath = fallback?.modelPath || fallback?.path || "";
      if (fallbackPath) {
        handleParaformerModelPathChange(fallbackPath);
      }
    },
    [handleParaformerModelPathChange, onLocalProviderSelect, paraformerModels]
  );

  const handleParaformerBinaryPathChange = useCallback(
    (value: string) => {
      setParaformerBinaryPath?.(value);
      onLocalProviderSelect?.("paraformer");
      setInternalLocalProvider("paraformer");
    },
    [onLocalProviderSelect, setParaformerBinaryPath]
  );

  const handlePickParaformerModel = useCallback(async () => {
    try {
      const result = await window.electronAPI?.pickParaformerModelFile?.(paraformerModelPath);
      if (result?.success && result.path) {
        handleParaformerModelPathChange(result.path);
      }
    } catch (error) {
      console.error("[TranscriptionModelPicker] Failed to pick Paraformer model:", error);
    }
  }, [paraformerModelPath, handleParaformerModelPathChange]);

  const handlePickParaformerBinary = useCallback(async () => {
    try {
      const result = await window.electronAPI?.pickParaformerBinary?.(paraformerBinaryPath);
      if (result?.success && result.path) {
        handleParaformerBinaryPathChange(result.path);
      }
    } catch (error) {
      console.error("[TranscriptionModelPicker] Failed to pick Paraformer binary:", error);
    }
  }, [paraformerBinaryPath, handleParaformerBinaryPathChange]);

  const handleBaseUrlBlur = useCallback(() => {
    if (!setCloudTranscriptionBaseUrl || selectedCloudProvider !== "custom") return;

    const trimmed = (cloudTranscriptionBaseUrl || "").trim();
    if (!trimmed) return;

    const { normalizeBaseUrl } = require("../config/constants");
    const normalized = normalizeBaseUrl(trimmed);

    if (normalized && normalized !== cloudTranscriptionBaseUrl) {
      setCloudTranscriptionBaseUrl(normalized);
    }
    if (normalized) {
      for (const provider of cloudProviders) {
        const providerNormalized = normalizeBaseUrl(provider.baseUrl);
        if (normalized === providerNormalized) {
          onCloudProviderSelect(provider.id);
          onCloudModelSelect("whisper-1");
          break;
        }
      }
    }
  }, [
    cloudTranscriptionBaseUrl,
    selectedCloudProvider,
    setCloudTranscriptionBaseUrl,
    onCloudProviderSelect,
    onCloudModelSelect,
    cloudProviders,
  ]);

  const handleDelete = useCallback(
    (modelId: string) => {
      showConfirmDialog({
        title: t("transcription.deleteModel.title"),
        description: t("transcription.deleteModel.description"),
        onConfirm: async () => {
          await deleteModel(modelId, async () => {
            const result = await window.electronAPI?.listWhisperModels();
            if (result?.success) {
              setLocalModels(result.models);
              validateAndSelectModel(result.models);
            }
          });
        },
        variant: "destructive",
      });
    },
    [showConfirmDialog, deleteModel, validateAndSelectModel, t]
  );

  const currentCloudProvider = useMemo<TranscriptionProviderData | undefined>(
    () => cloudProviders.find((p) => p.id === selectedCloudProvider),
    [cloudProviders, selectedCloudProvider]
  );

  const cloudModelOptions = useMemo(() => {
    if (!currentCloudProvider) return [];
    return currentCloudProvider.models.map((m) => ({
      value: m.id,
      label: m.name,
      description: m.descriptionKey
        ? t(m.descriptionKey, { defaultValue: m.description })
        : m.description,
      icon: getProviderIcon(selectedCloudProvider),
      invertInDark: isMonochromeProvider(selectedCloudProvider),
    }));
  }, [currentCloudProvider, selectedCloudProvider, t]);

  const progressDisplay = useMemo(() => {
    if (!useLocalWhisper) return null;

    if (downloadingModel && internalLocalProvider === "whisper") {
      const modelInfo = WHISPER_MODEL_INFO[downloadingModel];
      return (
        <DownloadProgressBar
          modelName={modelInfo?.name || downloadingModel}
          progress={downloadProgress}
          isInstalling={isInstalling}
        />
      );
    }

    if (downloadingParakeetModel && internalLocalProvider === "nvidia") {
      const modelInfo = PARAKEET_MODEL_INFO[downloadingParakeetModel];
      return (
        <DownloadProgressBar
          modelName={modelInfo?.name || downloadingParakeetModel}
          progress={parakeetDownloadProgress}
          isInstalling={isInstallingParakeet}
        />
      );
    }

    if (downloadingSenseVoiceModel && internalLocalProvider === "sensevoice") {
      const modelInfo = SENSEVOICE_MODEL_INFO[downloadingSenseVoiceModel];
      return (
        <DownloadProgressBar
          modelName={modelInfo?.name || downloadingSenseVoiceModel}
          progress={senseVoiceDownloadProgress}
          isInstalling={isInstallingSenseVoice}
        />
      );
    }

    if (downloadingParaformerModel && internalLocalProvider === "paraformer") {
      const modelInfo = PARAFORMER_MODEL_INFO[downloadingParaformerModel];
      return (
        <DownloadProgressBar
          modelName={modelInfo?.name || downloadingParaformerModel}
          progress={paraformerDownloadProgress}
          isInstalling={isInstallingParaformer}
        />
      );
    }

    return null;
  }, [
    downloadingModel,
    downloadProgress,
    isInstalling,
    downloadingParakeetModel,
    parakeetDownloadProgress,
    isInstallingParakeet,
    downloadingSenseVoiceModel,
    senseVoiceDownloadProgress,
    isInstallingSenseVoice,
    downloadingParaformerModel,
    paraformerDownloadProgress,
    isInstallingParaformer,
    useLocalWhisper,
    internalLocalProvider,
  ]);

  const renderLocalModels = () => {
    const modelsToRender =
      localModels.length === 0
        ? Object.entries(WHISPER_MODEL_INFO).map(([modelId, info]) => ({
            model: modelId,
            downloaded: false,
            size_mb: info.sizeMb,
          }))
        : localModels;

    return (
      <div className="space-y-2">
        <div className="space-y-0.5">
          {modelsToRender.map((model) => {
            const modelId = model.model;
            const info = WHISPER_MODEL_INFO[modelId] ?? {
              name: modelId,
              description: t("transcription.fallback.whisperModelDescription"),
              size: t("common.unknown"),
              recommended: false,
            };

            return (
              <LocalModelCard
                key={modelId}
                modelId={modelId}
                name={info.name}
                description={info.description}
                size={info.size}
                actualSizeMb={model.size_mb}
                isSelected={modelId === selectedWhisperModelId}
                isDownloaded={model.downloaded ?? false}
                isDownloading={isDownloadingModel(modelId)}
                isCancelling={isCancelling}
                recommended={info.recommended}
                provider="whisper"
                onSelect={() => handleWhisperModelSelect(modelId)}
                onDelete={() => handleDelete(modelId)}
                onDownload={() =>
                  downloadModel(modelId, (downloadedId) => {
                    setLocalModels((prev) =>
                      prev.map((m) => (m.model === downloadedId ? { ...m, downloaded: true } : m))
                    );
                    handleWhisperModelSelect(downloadedId);
                  })
                }
                onCancel={cancelDownload}
                styles={styles}
                modelPath={model.path}
              />
            );
          })}
        </div>

        <div className="rounded-md border border-border/50 bg-muted/20 px-2.5 py-2">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Download official Whisper models here, or use your own local `.bin` model file.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">Whisper Model (.bin)</label>
          <div className="flex items-center gap-1.5">
            <Input
              value={selectedWhisperModelPath}
              onChange={(e) => handleWhisperModelPathChange(e.target.value)}
              placeholder="/path/to/ggml-base.bin"
              className="h-8 text-sm"
            />
            <Button
              type="button"
              variant="outline"
              className="h-8 px-2 text-xs"
              onClick={handlePickWhisperModel}
            >
              Browse
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const handleParakeetDelete = useCallback(
    (modelId: string) => {
      showConfirmDialog({
        title: t("transcription.deleteModel.title"),
        description: t("transcription.deleteModel.description"),
        onConfirm: async () => {
          await deleteParakeetModel(modelId, async () => {
            const result = await window.electronAPI?.listParakeetModels();
            if (result?.success) {
              setParakeetModels(result.models);
            }
          });
        },
        variant: "destructive",
      });
    },
    [showConfirmDialog, deleteParakeetModel, t]
  );

  const getParakeetLanguageLabel = (language: string) => {
    return language === "multilingual"
      ? t("transcription.parakeet.multilingual")
      : t("transcription.parakeet.english");
  };

  const renderParakeetModels = () => {
    const modelsToRender =
      parakeetModels.length === 0
        ? Object.entries(PARAKEET_MODEL_INFO).map(([modelId, info]) => ({
            model: modelId,
            downloaded: false,
            size_mb: info.sizeMb,
          }))
        : parakeetModels;

    return (
      <div className="space-y-2">
        <div className="space-y-0.5">
          {modelsToRender.map((model) => {
            const modelId = model.model;
            const info = PARAKEET_MODEL_INFO[modelId] ?? {
              name: modelId,
              description: t("transcription.fallback.parakeetModelDescription"),
              size: t("common.unknown"),
              language: "en",
              recommended: false,
            };

            return (
              <LocalModelCard
                key={modelId}
                modelId={modelId}
                name={info.name}
                description={info.description}
                size={info.size}
                actualSizeMb={model.size_mb}
                isSelected={modelId === selectedParakeetModelId}
                isDownloaded={model.downloaded ?? false}
                isDownloading={isDownloadingParakeetModel(modelId)}
                isCancelling={isCancellingParakeet}
                recommended={info.recommended}
                provider="nvidia"
                languageLabel={getParakeetLanguageLabel(info.language)}
                onSelect={() => handleParakeetModelSelect(modelId)}
                onDelete={() => handleParakeetDelete(modelId)}
                onDownload={() =>
                  downloadParakeetModel(modelId, (downloadedId) => {
                    setParakeetModels((prev) =>
                      prev.map((m) => (m.model === downloadedId ? { ...m, downloaded: true } : m))
                    );
                    handleParakeetModelSelect(downloadedId);
                  })
                }
                onCancel={cancelParakeetDownload}
                styles={styles}
                modelPath={model.modelPath || model.path}
              />
            );
          })}
        </div>

        <div className="rounded-md border border-border/50 bg-muted/20 px-2.5 py-2">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Download official Parakeet models here, or choose a local model directory.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">Parakeet Model Directory</label>
          <div className="flex items-center gap-1.5">
            <Input
              value={selectedParakeetModelPath}
              onChange={(e) => handleParakeetModelPathChange(e.target.value)}
              placeholder="/path/to/parakeet-tdt-0.6b-v3"
              className="h-8 text-sm"
            />
            <Button
              type="button"
              variant="outline"
              className="h-8 px-2 text-xs"
              onClick={handlePickParakeetModelDirectory}
            >
              Browse
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const handleSenseVoiceDelete = useCallback(
    (modelId: string) => {
      showConfirmDialog({
        title: t("transcription.deleteModel.title"),
        description: t("transcription.deleteModel.description"),
        onConfirm: async () => {
          await deleteSenseVoiceModel(modelId, async () => {
            const result = await window.electronAPI?.listSenseVoiceModels();
            if (result?.success) {
              setSenseVoiceModels(result.models);
              if (selectedSenseVoiceModelId === modelId) {
                handleSenseVoiceModelPathChange("");
              }
            }
          });
        },
        variant: "destructive",
      });
    },
    [
      showConfirmDialog,
      deleteSenseVoiceModel,
      handleSenseVoiceModelPathChange,
      selectedSenseVoiceModelId,
      t,
    ]
  );

  const handleParaformerDelete = useCallback(
    (modelId: string) => {
      showConfirmDialog({
        title: t("transcription.deleteModel.title"),
        description: t("transcription.deleteModel.description"),
        onConfirm: async () => {
          await deleteParaformerModel(modelId, async () => {
            const result = await window.electronAPI?.listParaformerModels();
            if (result?.success) {
              setParaformerModels(result.models);
              if (selectedParaformerModelId === modelId) {
                handleParaformerModelPathChange("");
              }
            }
          });
        },
        variant: "destructive",
      });
    },
    [
      showConfirmDialog,
      deleteParaformerModel,
      handleParaformerModelPathChange,
      selectedParaformerModelId,
      t,
    ]
  );

  const renderSenseVoiceModels = () => {
    const modelsToRender =
      senseVoiceModels.length === 0
        ? Object.entries(SENSEVOICE_MODEL_INFO).map(([modelId, info]) => ({
            model: modelId,
            downloaded: false,
            size_mb: info.sizeMb,
          }))
        : senseVoiceModels;

    return (
      <div className="space-y-2">
        <div className="space-y-0.5">
          {modelsToRender.map((model) => {
            const modelId = model.model;
            const info = SENSEVOICE_MODEL_INFO[modelId] ?? {
              name: modelId,
              description: t("common.unknown"),
              size: t("common.unknown"),
              recommended: false,
            };

            return (
              <LocalModelCard
                key={modelId}
                modelId={modelId}
                name={info.name}
                description={info.description}
                size={info.size}
                actualSizeMb={model.size_mb}
                isSelected={modelId === selectedSenseVoiceModelId}
                isDownloaded={model.downloaded ?? false}
                isDownloading={isDownloadingSenseVoiceModel(modelId)}
                isCancelling={isCancellingSenseVoice}
                recommended={info.recommended}
                provider="sensevoice"
                onSelect={() => {
                  void handleSenseVoiceModelSelect(modelId);
                }}
                onDelete={() => handleSenseVoiceDelete(modelId)}
                onDownload={() =>
                  downloadSenseVoiceModel(modelId, (downloadedId) => {
                    setSenseVoiceModels((prev) =>
                      prev.map((m) => (m.model === downloadedId ? { ...m, downloaded: true } : m))
                    );
                    void handleSenseVoiceModelSelect(downloadedId);
                  })
                }
                onCancel={cancelSenseVoiceDownload}
                styles={styles}
                modelPath={model.modelPath || model.path}
              />
            );
          })}
        </div>

        <div className="rounded-md border border-border/50 bg-muted/20 px-2.5 py-2">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Download official SenseVoice GGUF models here, or use your own local GGUF file.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">SenseVoice Model (.gguf)</label>
          <div className="flex items-center gap-1.5">
            <Input
              value={senseVoiceModelPath}
              onChange={(e) => handleSenseVoiceModelPathChange(e.target.value)}
              placeholder="/path/to/sense-voice-small-q4_k.gguf"
              className="h-8 text-sm"
            />
            <Button
              type="button"
              variant="outline"
              className="h-8 px-2 text-xs"
              onClick={handlePickSenseVoiceModel}
            >
              Browse
            </Button>
          </div>
        </div>

        {senseVoiceBinaryStatus === "missing" && !isDownloadingSenseVoiceBinary && (
          <InfoBox variant="warning" className="space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "var(--color-warning)" }} />
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-foreground">
                  需要 SenseVoice 推理引擎
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  SenseVoice 模型文件（.gguf）需要配套的 C++ 推理引擎 sense-voice-main 才能运行。
                  点击下方按钮自动从源码编译（需要 cmake 和 C++ 编译器）。
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={handleDownloadSenseVoiceBinary}
                  >
                    <Download className="h-3.5 w-3.5" />
                    从源码编译
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={handlePickSenseVoiceBinary}
                  >
                    选择已有的二进制
                  </Button>
                </div>
              </div>
            </div>
          </InfoBox>
        )}

        {isDownloadingSenseVoiceBinary && (
          <div className="space-y-1.5 rounded-md border border-border/50 bg-muted/20 px-2.5 py-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">正在编译推理引擎...</span>
              <span className="text-[11px] text-muted-foreground">{senseVoiceBinaryDownloadProgress}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-border/50 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${senseVoiceBinaryDownloadProgress}%`,
                  background: "var(--color-primary)",
                }}
              />
            </div>
          </div>
        )}

        {senseVoiceBinaryStatus === "installed" && (
          <div className="rounded-md border border-green-500/20 bg-green-500/5 px-2.5 py-2">
            <p className="text-[11px] text-green-600 dark:text-green-400 leading-relaxed">
              ✓ 推理引擎已就绪
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">
            SenseVoice Binary (sense-voice-main)
          </label>
          <div className="flex items-center gap-1.5">
            <Input
              value={senseVoiceBinaryPath}
              onChange={(e) => handleSenseVoiceBinaryPathChange(e.target.value)}
              placeholder="/path/to/sense-voice-main"
              className="h-8 text-sm"
            />
            <Button
              type="button"
              variant="outline"
              className="h-8 px-2 text-xs"
              onClick={handlePickSenseVoiceBinary}
            >
              Browse
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const renderParaformerModels = () => {
    const modelsToRender =
      paraformerModels.length === 0
        ? Object.entries(PARAFORMER_MODEL_INFO).map(([modelId, info]) => ({
            model: modelId,
            downloaded: false,
            size_mb: info.sizeMb,
          }))
        : paraformerModels;

    return (
      <div className="space-y-2">
        <div className="space-y-0.5">
          {modelsToRender.map((model) => {
            const modelId = model.model;
            const info = PARAFORMER_MODEL_INFO[modelId] ?? {
              name: modelId,
              description: t("common.unknown"),
              size: t("common.unknown"),
              language: "zh/en",
              recommended: false,
            };

            return (
              <LocalModelCard
                key={modelId}
                modelId={modelId}
                name={info.name}
                description={info.description}
                size={info.size}
                actualSizeMb={model.size_mb}
                isSelected={modelId === selectedParaformerModelId}
                isDownloaded={model.downloaded ?? false}
                isDownloading={isDownloadingParaformerModel(modelId)}
                isCancelling={isCancellingParaformer}
                recommended={info.recommended}
                provider="paraformer"
                languageLabel={info.language}
                onSelect={() => {
                  void handleParaformerModelSelect(modelId);
                }}
                onDelete={() => handleParaformerDelete(modelId)}
                onDownload={() =>
                  downloadParaformerModel(modelId, (downloadedId) => {
                    setParaformerModels((prev) =>
                      prev.map((m) => (m.model === downloadedId ? { ...m, downloaded: true } : m))
                    );
                    void handleParaformerModelSelect(downloadedId);
                  })
                }
                onCancel={cancelParaformerDownload}
                styles={styles}
                modelPath={model.modelPath || model.path}
              />
            );
          })}
        </div>

        <div className="rounded-md border border-border/50 bg-muted/20 px-2.5 py-2">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Download Paraformer-Large model for Chinese/English transcription, or choose a local model directory.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">Paraformer Model Directory</label>
          <div className="flex items-center gap-1.5">
            <Input
              value={paraformerModelPath}
              onChange={(e) => handleParaformerModelPathChange(e.target.value)}
              placeholder="/path/to/paraformer-large-zh"
              className="h-8 text-sm"
            />
            <Button
              type="button"
              variant="outline"
              className="h-8 px-2 text-xs"
              onClick={handlePickParaformerModel}
            >
              Browse
            </Button>
          </div>
        </div>

        {/* Paraformer binary status */}
        {paraformerBinaryStatus === "missing" && !isDownloadingParaformerBinary && (
          <InfoBox variant="warning" className="space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "var(--color-warning)" }} />
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-foreground">需要 Paraformer 推理引擎</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Paraformer 模型需要配套的推理引擎 paraformer-main 才能运行。
                  点击下方按钮自动下载预编译版本。
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={handleDownloadParaformerBinary}
                  >
                    <Download className="h-3.5 w-3.5" />
                    下载推理引擎
                  </Button>
                </div>
              </div>
            </div>
          </InfoBox>
        )}

        {isDownloadingParaformerBinary && (
          <div className="space-y-1.5 rounded-md border border-border/50 bg-muted/20 px-2.5 py-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">正在下载推理引擎...</span>
              <span className="text-[11px] text-muted-foreground">{paraformerBinaryDownloadProgress}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-border/50 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${paraformerBinaryDownloadProgress}%`,
                  background: "var(--color-primary)",
                }}
              />
            </div>
          </div>
        )}

        {paraformerBinaryStatus === "installed" && (
          <div className="rounded-md border border-green-500/20 bg-green-500/5 px-2.5 py-2">
            <p className="text-[11px] text-green-600 dark:text-green-400 leading-relaxed">
              ✓ 推理引擎已就绪
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">
            Paraformer Binary (paraformer-main)
          </label>
          <div className="flex items-center gap-1.5">
            <Input
              value={paraformerBinaryPath}
              onChange={(e) => handleParaformerBinaryPathChange(e.target.value)}
              placeholder="/path/to/paraformer-main"
              className="h-8 text-sm"
            />
            <Button
              type="button"
              variant="outline"
              className="h-8 px-2 text-xs"
              onClick={handlePickParaformerBinary}
            >
              Browse
            </Button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <ModeToggle useLocalWhisper={useLocalWhisper} onModeChange={handleModeChange} />

      {!useLocalWhisper ? (
        <div className={styles.container}>
          <div className="p-2 pb-0">
            <ProviderTabs
              providers={cloudProviderTabs}
              selectedId={selectedCloudProvider}
              onSelect={handleCloudProviderChange}
              colorScheme={colorScheme === "purple" ? "purple" : "indigo"}
              scrollable
            />
          </div>

          <div className="p-2">
            {selectedCloudProvider === "custom" ? (
              <div className="space-y-2">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-foreground">
                    {t("transcription.endpointUrl")}
                  </label>
                  <Input
                    value={cloudTranscriptionBaseUrl}
                    onChange={(e) => setCloudTranscriptionBaseUrl?.(e.target.value)}
                    onBlur={handleBaseUrlBlur}
                    placeholder="https://your-api.example.com/v1"
                    className="h-8 text-sm"
                  />
                </div>

                <ApiKeyInput
                  apiKey={customTranscriptionApiKey}
                  setApiKey={setCustomTranscriptionApiKey || (() => {})}
                  label={t("transcription.apiKeyOptional")}
                  helpText=""
                />

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-foreground">
                    {t("common.model")}
                  </label>
                  <Input
                    value={selectedCloudModel}
                    onChange={(e) => onCloudModelSelect(e.target.value)}
                    placeholder="whisper-1"
                    className="h-8 text-sm"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-foreground">
                      {t("common.apiKey")}
                    </label>
                    <button
                      type="button"
                      onClick={createExternalLinkHandler(
                        {
                          groq: "https://console.groq.com/keys",
                          mistral: "https://console.mistral.ai/api-keys",
                          openai: "https://platform.openai.com/api-keys",
                        }[selectedCloudProvider] || "https://platform.openai.com/api-keys"
                      )}
                      className="text-[11px] text-white/70 hover:text-white transition-colors cursor-pointer"
                    >
                      {t("transcription.getKey")}
                    </button>
                  </div>
                  <ApiKeyInput
                    apiKey={
                      { groq: groqApiKey, mistral: mistralApiKey, openai: openaiApiKey }[
                        selectedCloudProvider
                      ] || openaiApiKey
                    }
                    setApiKey={
                      { groq: setGroqApiKey, mistral: setMistralApiKey, openai: setOpenaiApiKey }[
                        selectedCloudProvider
                      ] || setOpenaiApiKey
                    }
                    label=""
                    helpText=""
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">{t("common.model")}</label>
                  <ModelCardList
                    models={cloudModelOptions}
                    selectedModel={selectedCloudModel}
                    onModelSelect={onCloudModelSelect}
                    colorScheme={colorScheme === "purple" ? "purple" : "indigo"}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className={styles.container}>
          <div className="p-2 pb-0">
            <ProviderTabs
              providers={LOCAL_PROVIDER_TABS}
              selectedId={internalLocalProvider}
              onSelect={handleLocalProviderChange}
              colorScheme={colorScheme === "purple" ? "purple" : "indigo"}
            />
          </div>

          {progressDisplay}

          <div className="p-2">
            {internalLocalProvider === "whisper" && renderLocalModels()}
            {internalLocalProvider === "nvidia" && renderParakeetModels()}
            {internalLocalProvider === "sensevoice" && renderSenseVoiceModels()}
            {internalLocalProvider === "paraformer" && renderParaformerModels()}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => !open && hideConfirmDialog()}
        title={confirmDialog.title}
        description={confirmDialog.description}
        confirmText={confirmDialog.confirmText}
        cancelText={confirmDialog.cancelText}
        onConfirm={confirmDialog.onConfirm}
        variant={confirmDialog.variant}
      />

      <AlertDialog
        open={whisperAlertDialog.open}
        onOpenChange={(open) => !open && hideWhisperAlertDialog()}
        title={whisperAlertDialog.title}
        description={whisperAlertDialog.description}
        onOk={hideWhisperAlertDialog}
      />
      <AlertDialog
        open={parakeetAlertDialog.open}
        onOpenChange={(open) => !open && hideParakeetAlertDialog()}
        title={parakeetAlertDialog.title}
        description={parakeetAlertDialog.description}
        onOk={hideParakeetAlertDialog}
      />
      <AlertDialog
        open={senseVoiceAlertDialog.open}
        onOpenChange={(open) => !open && hideSenseVoiceAlertDialog()}
        title={senseVoiceAlertDialog.title}
        description={senseVoiceAlertDialog.description}
        onOk={hideSenseVoiceAlertDialog}
      />
      <AlertDialog
        open={paraformerAlertDialog.open}
        onOpenChange={(open) => !open && hideParaformerAlertDialog()}
        title={paraformerAlertDialog.title}
        description={paraformerAlertDialog.description}
        onOk={hideParaformerAlertDialog}
      />
    </div>
  );
}
