/** Dispatches bounded work, favoring previews without starving background extraction. */

/** After this many previews in a row, one waiting background task goes next. */
const FOREGROUND_STREAK = 3;

/**
 * A queue that runs at most `capacity` tasks at once. Foreground tasks go first, but never more
 * than `FOREGROUND_STREAK` in a row while background work waits.
 */
export function createScheduler(capacity: number) {
  type Task = { start: () => void; foreground: boolean };
  const waiting: Task[] = [];
  let running = 0;
  let foregroundStreak = 0;

  function takeNext(): Task {
    const wantForeground = foregroundStreak < FOREGROUND_STREAK;
    const preferred = waiting.findIndex((task) => task.foreground === wantForeground);
    const [task] = waiting.splice(Math.max(preferred, 0), 1);
    return task!;
  }

  function startWaiting(): void {
    while (running < capacity && waiting.length > 0) {
      const task = takeNext();
      foregroundStreak = task.foreground ? foregroundStreak + 1 : 0;
      running++;
      task.start();
    }
  }

  return <T>(run: () => Promise<T>, foreground = false): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const finish = () => {
        running--;
        startWaiting();
      };
      const start = () => {
        void Promise.resolve().then(run).then(resolve, reject).then(finish, finish);
      };
      waiting.push({ foreground, start });
      startWaiting();
    });
}
