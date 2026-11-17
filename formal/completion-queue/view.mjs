// pstack /statechart view for CompletionQueue.tla: labels in the reader's words.
const TAB = { t1: 'Tab A', t2: 'Tab B' };

const phase = (pc) => {
  if (pc === 'idle') {
    return 'Idle';
  }
  if (pc.startsWith('acq')) {
    return 'Taking the lease';
  }
  if (pc === 'inflight') {
    return 'Waiting for the server';
  }
  if (pc.startsWith('rel')) {
    return 'Giving the lease back';
  }
  return 'Draining';
};

const queue = (v) => {
  const withdrawn = v.cleared.includes('c1');
  const stored = v.store.c1 >= 0;
  if (withdrawn) {
    return stored ? 'Withdrawn record is back' : 'Withdrawn';
  }
  return stored ? 'Record queued' : 'Nothing queued';
};

export const title = 'Completion queue: one record, reset all';

export const state = (v) => {
  const regions = {};
  for (const t of Object.keys(v.pc)) {
    regions[TAB[t] ?? t] = phase(v.pc[t]);
  }
  regions['Browser storage'] = queue(v);
  regions.Server = v.records.length > 0 ? 'Recorded' : 'Not recorded';
  return regions;
};

const ACTIONS = {
  Enqueue: 'a guide is completed',
  Reset: 'the reader resets all progress',
  StartDrain: 'the drain timer fires',
  AcqRead: 'the tab reads the lease',
  AcqWrite: 'the tab writes its lease',
  AcqCheck: 'the tab reads the lease back',
  NextItem: 'the tab takes the next record',
  RenRead: 'the tab reads the lease',
  RenWrite: 'the tab renews its lease',
  SendPost: 'the tab sends the record',
  ServerApply: 'the server saves the record',
  PostCreated: 'the server answers created',
  PostTransient: 'the request fails or times out',
  RePut: 'the tab saves the retry',
  HoldPut: 'the tab saves the held record',
  RelRead: 'the tab reads the lease',
  RelRemove: 'the tab removes its lease',
  LeaseExpires: 'the lease expires',
};

// A reset empties the resetting tab's memory, so a tab that still holds an id
// afterwards did not reset.
const resetter = (from, to) => {
  const tabs = Object.keys(to.items);
  const emptied = tabs.filter((t) => from.items[t].length > 0 && to.items[t].length === 0);
  const candidates = emptied.length > 0 ? emptied : tabs.filter((t) => to.items[t].length === 0);
  return candidates.length === 1 ? ` in ${TAB[candidates[0]] ?? candidates[0]}` : '';
};

export const step = (action, from, to) =>
  action === 'Reset' ? `${ACTIONS.Reset}${resetter(from, to)}` : (ACTIONS[action] ?? action);
