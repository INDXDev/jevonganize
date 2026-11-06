/** Dispatches bounded work, favoring previews without starving background extraction. */
export function createScheduler(capacity: number) {
  type Job = { start: () => void; foreground: boolean };
  const queue: Job[] = [];
  let active = 0;
  let foregroundRuns = 0;

  function drain(): void {
    while (active < capacity && queue.length) {
      const preferForeground = foregroundRuns < 3;
      let index = queue.findIndex((job) => job.foreground === preferForeground);
      if (index < 0) index = 0;
      const [job] = queue.splice(index, 1);
      foregroundRuns = job!.foreground ? foregroundRuns + 1 : 0;
      active++;
      job!.start();
    }
  }

  return <T>(run: () => Promise<T>, foreground = false): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const finish = () => {
        active--;
        drain();
      };
      queue.push({
        foreground,
        start: () => {
          void Promise.resolve().then(run).then(resolve, reject).then(finish, finish);
        },
      });
      drain();
    });
}
