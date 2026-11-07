import { t } from '../i18n/index.ts';
import type { Status } from '../../types.ts';
import { useTool } from '../api.ts';
import { Block } from '../components/block.tsx';
import { FolderPicker } from '../components/folder-picker.tsx';
import { useTabs, useWindow } from '../tabs.ts';
import { useFirstRun } from './onboarding-run.ts';
import {
  useOpenAiKey,
  useLastError,
  useStartFolder,
  usePacks,
  type RunRecordingError,
} from './onboarding-state.ts';
import {
  CostStep,
  FolderStep,
  Intro,
  KeyStep,
  PacksStep,
  StartBar,
  TopicsStep,
} from './onboarding-steps.tsx';

type Steps = {
  status: Status | undefined;
  apiKey: ReturnType<typeof useOpenAiKey>;
  folderChoice: ReturnType<typeof useStartFolder>;
  firstRun: ReturnType<typeof useFirstRun>;
  runRecordingError: RunRecordingError;
};

/** The numbered steps, in order: key, folder, packs, topics, then what the run will cost. */
function StepList({ status, apiKey, folderChoice, firstRun, runRecordingError }: Steps) {
  const { packs, setPackEnabled } = usePacks(runRecordingError);
  const usable = folderChoice.isTaggable;
  return (
    <ol className="relative before:absolute before:inset-y-3 before:left-2.5 before:w-px before:bg-strong">
      <KeyStep
        haveKey={apiKey.haveKey}
        value={apiKey.typedKey}
        onChange={apiKey.setTypedKey}
        onSave={() => void apiKey.saveKey()}
        inEnv={apiKey.envKeyFound}
        fromEnv={apiKey.usingEnvKey}
        onUseEnv={() => void apiKey.adoptEnvKey()}
      />
      <FolderStep
        library={folderChoice.library}
        files={firstRun.wholeFolder?.files}
        usable={usable}
        onChoose={() => folderChoice.setIsPicking(true)}
      />
      <PacksStep
        usable={usable}
        packs={packs}
        onToggle={(id, enabled) => void setPackEnabled(id, enabled)}
      />
      <TopicsStep
        usable={usable}
        canChoose={apiKey.haveKey && !firstRun.job}
        picking={firstRun.isChoosing}
        topics={firstRun.topics}
        onChange={firstRun.setTopics}
        onChoose={() => void firstRun.askModelForTopics()}
      />
      <CostStep
        usable={usable}
        provider={status?.provider ?? t('your provider')}
        estimate={firstRun.estimate}
        wholeFolder={firstRun.wholeFolder}
        coverAll={firstRun.coverAll}
        onCoverAll={firstRun.setCoverAll}
      />
    </ol>
  );
}

/** The first screen: key, folder, packs, topics, then a cost notice. Starting the run writes tags, which undo reverses. */
export function Onboarding() {
  const navigate = useTabs((s) => s.navigate);
  const { data: status } = useTool('status', {});
  const { error, runRecordingError } = useLastError();
  const apiKey = useOpenAiKey(status, runRecordingError);
  const folderChoice = useStartFolder(runRecordingError);
  const { library, isTaggable } = folderChoice;
  const firstRun = useFirstRun({ library, isTaggable, status, runRecordingError });
  const canStart = isTaggable && apiKey.haveKey && !firstRun.job && !firstRun.isChoosing;

  const skip = () => {
    useWindow.setState({ skipped: true });
    navigate('');
  };

  return (
    <main className="dotgrid h-full overflow-y-auto bg-background">
      {/* No title bar here, so this strip is what moves the desktop window. */}
      <div aria-hidden className="app-drag fixed inset-x-0 top-0 h-titlebar" />
      <div className="mx-auto max-w-[42rem] px-6 py-12">
        <Intro />
        <div className="rounded-lg border border-strong bg-surface-1 p-6">
          <StepList
            status={status}
            apiKey={apiKey}
            folderChoice={folderChoice}
            firstRun={firstRun}
            runRecordingError={runRecordingError}
          />
          {firstRun.job && <Block job={firstRun.job} />}
          {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
          <StartBar
            startRef={firstRun.startRef}
            canStart={canStart}
            onSkip={skip}
            onStart={() => void firstRun.startRun()}
          />
        </div>
      </div>
      <FolderPicker
        open={folderChoice.isPicking}
        onClose={() => folderChoice.setIsPicking(false)}
        onPick={folderChoice.addAndScanFolder}
      />
    </main>
  );
}
