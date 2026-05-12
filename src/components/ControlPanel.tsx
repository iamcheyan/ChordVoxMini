import React, { Suspense, useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import {
  Trash2,
  Settings,
  FileText,
  Mic,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import type { SettingsSectionType } from "./SettingsModal";
import TitleBar from "./TitleBar";
import SupportDropdown from "./ui/SupportDropdown";
import TranscriptionItem from "./ui/TranscriptionItem";
import { ConfirmDialog, AlertDialog } from "./ui/dialog";
import { useDialogs } from "../hooks/useDialogs";
import { useHotkey } from "../hooks/useHotkey";
import { useToast } from "./ui/Toast";
import { useSettings } from "../hooks/useSettings";
import {
  useTranscriptions,
  initializeTranscriptions,
  removeTranscription as removeFromStore,
  clearTranscriptions as clearStoreTranscriptions,
} from "../stores/transcriptionStore";
import { formatHotkeyLabel } from "../utils/hotkeys";

const SettingsModal = React.lazy(() => import("./SettingsModal"));

export default function ControlPanel() {
  const { t } = useTranslation();
  const history = useTranscriptions();
  const [isLoading, setIsLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(true);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionType | undefined>("general");
  const [aiCTADismissed, setAiCTADismissed] = useState(
    () => localStorage.getItem("aiCTADismissed") === "true"
  );
  const { hotkey } = useHotkey();
  const { toast } = useToast();
  const { useReasoningModel } = useSettings();

  const {
    confirmDialog,
    alertDialog,
    showConfirmDialog,
    showAlertDialog,
    hideConfirmDialog,
    hideAlertDialog,
  } = useDialogs();

  useEffect(() => {
    loadTranscriptions();
  }, []);

  const loadTranscriptions = async () => {
    try {
      setIsLoading(true);
      await initializeTranscriptions();
    } catch (error) {
      showAlertDialog({
        title: t("controlPanel.history.couldNotLoadTitle"),
        description: t("controlPanel.history.couldNotLoadDescription"),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast({
          title: t("controlPanel.history.copiedTitle"),
          description: t("controlPanel.history.copiedDescription"),
          variant: "success",
          duration: 2000,
        });
      } catch (err) {
        toast({
          title: t("controlPanel.history.couldNotCopyTitle"),
          description: t("controlPanel.history.couldNotCopyDescription"),
          variant: "destructive",
        });
      }
    },
    [toast, t]
  );

  const clearHistory = useCallback(async () => {
    showConfirmDialog({
      title: t("controlPanel.history.clearTitle"),
      description: t("controlPanel.history.clearDescription"),
      onConfirm: async () => {
        try {
          const result = await window.electronAPI.clearTranscriptions();
          clearStoreTranscriptions();
          toast({
            title: t("controlPanel.history.clearedTitle"),
            description: t("controlPanel.history.clearedDescription", {
              count: result.cleared,
            }),
            variant: "success",
            duration: 3000,
          });
        } catch (error) {
          toast({
            title: t("controlPanel.history.couldNotClearTitle"),
            description: t("controlPanel.history.couldNotClearDescription"),
            variant: "destructive",
          });
        }
      },
      variant: "destructive",
    });
  }, [showConfirmDialog, toast, t]);

  const deleteTranscription = useCallback(
    async (id: number) => {
      showConfirmDialog({
        title: t("controlPanel.history.deleteTitle"),
        description: t("controlPanel.history.deleteDescription"),
        onConfirm: async () => {
          try {
            const result = await window.electronAPI.deleteTranscription(id);
            if (result.success) {
              removeFromStore(id);
            } else {
              showAlertDialog({
                title: t("controlPanel.history.couldNotDeleteTitle"),
                description: t("controlPanel.history.couldNotDeleteDescription"),
              });
            }
          } catch (error) {
            showAlertDialog({
              title: t("controlPanel.history.couldNotDeleteTitle"),
              description: t("controlPanel.history.couldNotDeleteDescriptionGeneric"),
            });
          }
        },
        variant: "destructive",
      });
    },
    [showConfirmDialog, showAlertDialog, t]
  );

  const handleOpenHistoryFromPrivacy = useCallback(() => {
    setShowSettings(false);
    setSettingsSection(undefined);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={hideConfirmDialog}
        title={confirmDialog.title}
        description={confirmDialog.description}
        onConfirm={confirmDialog.onConfirm}
        variant={confirmDialog.variant}
      />

      <AlertDialog
        open={alertDialog.open}
        onOpenChange={hideAlertDialog}
        title={alertDialog.title}
        description={alertDialog.description}
        onOk={() => {}}
      />

      <TitleBar
        actions={
          <>
            <SupportDropdown />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setSettingsSection(undefined);
                setShowSettings(true);
              }}
              className="text-foreground/70 hover:text-foreground hover:bg-foreground/10"
            >
              <Settings size={16} />
            </Button>
          </>
        }
      />

      {showSettings && (
        <Suspense fallback={null}>
          <SettingsModal
            open={showSettings}
            onOpenChange={(open) => {
              setShowSettings(open);
              if (!open) setSettingsSection(undefined);
            }}
            initialSection={settingsSection}
            onOpenTranscriptionHistory={handleOpenHistoryFromPrivacy}
          />
        </Suspense>
      )}

      <div className="p-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-3 px-1">
            <div className="flex items-center gap-2">
              <FileText size={14} className="text-primary" />
              <h2 className="text-sm font-semibold text-foreground">
                {t("controlPanel.history.title")}
              </h2>
              {history.length > 0 && (
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  ({history.length})
                </span>
              )}
            </div>
            {history.length > 0 && (
              <Button
                onClick={clearHistory}
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 size={12} className="mr-1" />
                {t("controlPanel.history.clear")}
              </Button>
            )}
          </div>

          {!useReasoningModel && !aiCTADismissed && (
            <div className="mb-4 relative rounded border border-border bg-muted/30 p-3 overflow-hidden">
              <button
                onClick={() => {
                  localStorage.setItem("aiCTADismissed", "true");
                  setAiCTADismissed(true);
                }}
                className="absolute top-2 right-2 p-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X size={14} />
              </button>
              <div className="flex items-start gap-3 pr-6 relative z-10">
                <div className="shrink-0 w-8 h-8 rounded bg-background border border-border flex items-center justify-center">
                  <Sparkles size={16} className="text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-foreground mb-1">
                    {t("controlPanel.aiCta.title")}
                  </p>
                  <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">
                    {t("controlPanel.aiCta.description")}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-3 text-[10px] font-medium"
                    onClick={() => {
                      setSettingsSection("aiModels");
                      setShowSettings(true);
                    }}
                  >
                    {t("controlPanel.aiCta.enable")}
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div className="bg-card border border-border rounded overflow-hidden animate-fade-in">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-8">
                <Loader2 size={14} className="animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">{t("controlPanel.loading")}</span>
              </div>
            ) : history.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4">
                <div className="w-10 h-10 rounded-md bg-muted/50 dark:bg-white/4 flex items-center justify-center mb-3">
                  <Mic size={18} className="text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  {t("controlPanel.history.empty")}
                </p>
                <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                  <span>{t("controlPanel.history.press")}</span>
                  <kbd className="inline-flex items-center h-5 px-1.5 rounded-sm bg-surface-1 dark:bg-white/6 border border-border text-[11px] font-mono font-medium">
                    {formatHotkeyLabel(hotkey)}
                  </kbd>
                  <span>{t("controlPanel.history.toStart")}</span>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-border/50 max-h-[calc(100vh-180px)] overflow-y-auto">
                {history.map((item, index) => (
                  <TranscriptionItem
                    key={item.id}
                    item={item}
                    index={index}
                    total={history.length}
                    onCopy={copyToClipboard}
                    onDelete={deleteTranscription}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
