import { incordCopy as incord } from '../config/incord';
import * as stats from '../stats';

import { tick } from 'svelte';
import { copy as ui } from '../config/copy';

import { applyPracticeTap, undoPracticeTap } from '../engine/undo';
import { firstLetters, grade, transition, schedule } from '../engine';

import { persist, ensureItemText, today, type Item } from '../store';
import type { AppRuntime } from './state.svelte';

export function createPracticeController(
  vm: Pick<
    AppRuntime,
    | 'feedback'
    | 'data'
    | 'tapUndo'
    | 'typedLetter'
    | 'practiceAnnouncement'
    | 'letterTimer'
    | 'tapUndoTimer'
    | 'clearAction'
    | 'hasTapped'
    | 'position'
    | 'slips'
    | 'visualSlips'
    | 'confirmLeavePractice'
    | 'practice'
    | 'learned'
    | 'result'
    | 'session'
    | 'completing'
    | 'practiceRegion'
    | 'words'
    | 'loadingPassage'
    | 'showPracticeInstruction'
    | 'pushView'
    | 'passageRequest'
    | 'live'
    | 'practiceLoadRequest'
    | 'noteAction'
    | 'review'
    | 'shortcut'
    | 'rehearsal'
    | 'titleExpanded'
    | 'nextDue'
    | 'mask'
    | 'typedSlip'
    | 'resultLearned'
    | 'attemptStep'
    | 'hidden'
    | 'resultTitle'
    | 'resultDetail'
    | 'attentionDirty'
    | 'save'
  >,
) {
  function unlockPractice() {
    vm.feedback.unlock(vm.data.settings);
  }
  function clearTapFeedback() {
    vm.tapUndo = null;
    vm.typedLetter = '';
    vm.practiceAnnouncement = '';
    clearTimeout(vm.letterTimer);
    clearTimeout(vm.tapUndoTimer);
  }
  function resetAttempt() {
    vm.clearAction('practice');
    clearTapFeedback();
    vm.hasTapped = false;
    vm.position = 0;
    vm.slips = [];
    vm.visualSlips = [];
  }
  function closePractice() {
    vm.confirmLeavePractice = false;
    clearTapFeedback();
    vm.practice = null;
    vm.learned = false;
    vm.result = false;
    vm.session = [];
  }
  function requestClosePractice() {
    if (vm.completing) return;
    if (vm.hasTapped && !vm.learned && !vm.result) vm.confirmLeavePractice = true;
    else closePractice();
  }
  function focusPractice() {
    void tick().then(() => {
      if (vm.practice && !vm.result && !vm.learned && !vm.confirmLeavePractice)
        vm.practiceRegion?.focus({ preventScroll: true });
    });
  }
  function undoTap() {
    const restored = undoPracticeTap(
      { position: vm.position, slips: vm.slips, visualSlips: vm.visualSlips },
      vm.tapUndo,
      Date.now(),
    );
    vm.position = restored.position;
    vm.slips = restored.slips;
    vm.visualSlips = restored.visualSlips;
    clearTapFeedback();
    vm.practiceAnnouncement =
      ui.practicePosition(vm.position, vm.words.length) + '. ' + ui.practiceUndone;
    focusPractice();
  }
  function begin(items: Item[]) {
    if (!items.length || vm.loadingPassage) return;
    vm.showPracticeInstruction = true;
    vm.session = items.map((i) => i.id);
    void loadNext();
    vm.pushView();
  }
  async function loadNext() {
    const request = ++vm.passageRequest;
    const id = vm.session.shift();
    if (!id) {
      vm.practice = null;
      vm.learned = false;
      vm.result = false;
      return;
    }
    vm.clearAction('practice-load-' + id);
    let item = vm.live.find((i) => i.id === id);
    if (!item) {
      void loadNext();
      return;
    }
    if (item.translation === 'ESV' && !item.text) {
      vm.loadingPassage = true;
      vm.practiceLoadRequest = request;
      try {
        const loaded = await ensureItemText({ ...item });
        if (request !== vm.passageRequest) return;
        item = loaded;
        const index = vm.data.items.findIndex((i) => i.id === id && !i.deleted);
        if (index < 0) return;
        vm.data.items[index] = { ...vm.data.items[index], text: item.text };
        await persist($state.snapshot(vm.data));
      } catch (e) {
        if (request === vm.passageRequest) {
          vm.practice = null;
          vm.session.unshift(id);
          vm.noteAction(
            'practice-load-' + id,
            e instanceof Error ? e.message : incord.esvOffline,
            true,
          );
        }
        return;
      } finally {
        if (request === vm.passageRequest) vm.loadingPassage = false;
        if (vm.practiceLoadRequest === request) vm.practiceLoadRequest = 0;
      }
    }
    if (request !== vm.passageRequest) return;
    vm.practice = { ...item };
    vm.review = item.learned;
    vm.shortcut = false;
    vm.rehearsal = false;
    vm.learned = false;
    resetAttempt();
    vm.titleExpanded = false;
    vm.result = false;
    vm.nextDue = '';
    stats.trackStats('practice_start');
  }
  function key(key: string) {
    if (
      !vm.practice ||
      vm.result ||
      vm.completing ||
      vm.learned ||
      vm.confirmLeavePractice ||
      vm.position >= vm.words.length
    )
      return;
    const word = vm.words[vm.position],
      wrong = !firstLetters(word).includes(key.toLowerCase());
    const tap = applyPracticeTap(
      { position: vm.position, slips: vm.slips, visualSlips: vm.visualSlips },
      wrong,
      !!vm.mask[vm.position],
      vm.words.length,
      Date.now(),
    );
    vm.showPracticeInstruction = false;
    vm.hasTapped = true;
    vm.position = tap.state.position;
    vm.slips = tap.state.slips;
    vm.visualSlips = tap.state.visualSlips;
    vm.tapUndo = tap.undo;
    clearTimeout(vm.letterTimer);
    clearTimeout(vm.tapUndoTimer);
    vm.typedLetter = key.toUpperCase();
    vm.typedSlip = wrong;
    vm.letterTimer = setTimeout(() => (vm.typedLetter = ''), 600);
    if (vm.tapUndo)
      vm.tapUndoTimer = setTimeout(() => {
        const focused = document.activeElement?.classList.contains('practice-undo');
        vm.tapUndo = null;
        if (focused) focusPractice();
      }, 2000);
    vm.practiceAnnouncement =
      ui.practicePosition(vm.position, vm.words.length) +
      '. ' +
      (wrong ? ui.practiceSlip : ui.practiceCorrect);
    vm.feedback.play({ keySounds: vm.data.settings.keySounds }, wrong);
    if (vm.position >= vm.words.length) {
      vm.completing = true;
      void finish()
        .then(() => {
          if (vm.practice) {
            if (vm.resultLearned) continueResult();
            else vm.result = true;
          }
        })
        .catch((e) => {
          vm.noteAction('practice', e instanceof Error ? e.message : String(e), true);
        })
        .finally(() => (vm.completing = false));
    }
  }
  function physical(e: KeyboardEvent) {
    if (
      vm.practiceRegion?.contains(document.activeElement) &&
      vm.practice &&
      !vm.result &&
      !vm.learned &&
      !vm.completing &&
      !vm.confirmLeavePractice &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      (/^[a-z0-9]$/i.test(e.key) || (e.key === 'Backspace' && !!vm.tapUndo))
    ) {
      e.preventDefault();
      if (e.key === 'Backspace') undoTap();
      else key(e.key);
    }
  }
  async function finish() {
    if (!vm.practice) return;
    const now = new Date(),
      step = vm.attemptStep,
      wasReview = vm.review,
      hiddenCount = vm.hidden;
    const g = grade(vm.slips.length, hiddenCount);
    const out = transition(step, vm.slips.length, hiddenCount, vm.shortcut);
    vm.resultLearned = false;
    vm.resultTitle = wasReview
      ? { Again: ui.reviewAgain, Hard: ui.reviewHard, Good: ui.reviewGood, Easy: ui.reviewEasy }[g]
      : out.learned
        ? ui.learned
        : out.step > step
          ? ui.stepPassedTitle(step)
          : ui.repeatStep;
    vm.resultDetail = step === 1 ? ui.readAlongDone : ui.memoryResult(hiddenCount, vm.slips.length);
    if (vm.rehearsal) {
      vm.resultTitle = ui.practiceComplete;
      return;
    }
    if (wasReview) stats.trackStats(`review:${g.toLowerCase()}`);
    else if (vm.shortcut) stats.trackStats(`i_know_this:${out.learned ? 'pass' : 'fail'}`);
    else stats.trackStats(`step_${out.learned || out.step > step ? 'pass' : 'fail'}:${step}`);
    if (!wasReview && out.learned) stats.trackStats('learned');
    let fsrsLog: any = null;
    if (wasReview || out.learned) {
      const scheduled = schedule(vm.practice.card, g, now);
      fsrsLog = scheduled.log;
      vm.practice.card = scheduled.card;
      vm.practice.due = new Date(scheduled.card.due).toISOString();
      vm.nextDue = new Date(vm.practice.due).toLocaleDateString(undefined, { weekday: 'long' });
      vm.resultDetail = wasReview && g === 'Again' ? ui.relearnDetail : ui.backOn(vm.nextDue);
      if (wasReview) {
        vm.practice.learned = g !== 'Again';
        vm.practice.step = g === 'Again' ? 3 : 4;
      } else {
        vm.practice.step = out.step;
        vm.practice.learned = true;
        vm.practice.learnedAt = now.toISOString();
      }
      vm.resultLearned = vm.practice.learned;
    } else {
      vm.practice.step = out.step;
      vm.practice.learned = out.learned;
    }
    vm.practice.updatedAt = Date.now();
    const index = vm.data.items.findIndex((i) => i.id === vm.practice!.id && !i.deleted);
    if (index >= 0) vm.data.items[index] = { ...vm.practice };
    const event = {
      id: crypto.randomUUID(),
      itemId: vm.practice.id,
      at: now.toISOString(),
      slips: vm.slips.length,
      hidden: hiddenCount,
      grade: g,
      mode: wasReview ? 'review' : 'learn',
      step,
      fsrsLog,
    };
    vm.data.events.push(event);
    vm.data.queue.push(event.id);
    if (!vm.data.settings.days.includes(today())) vm.data.settings.days.push(today());
    vm.data.settings.lastActive = today();
    if (wasReview || out.learned) vm.attentionDirty = true;
    await vm.save();
  }
  function continueResult() {
    vm.result = false;
    resetAttempt();
    if (vm.rehearsal) {
      vm.practice = null;
      return;
    }
    vm.learned = vm.resultLearned;
    if (!vm.learned) vm.review = vm.practice?.learned || false;
    vm.shortcut = false;
  }
  function know() {
    if (vm.completing) return;
    if (vm.practice) {
      vm.shortcut = true;
      resetAttempt();
    }
  }
  function restart() {
    if (vm.completing) return;
    resetAttempt();
    vm.result = false;
  }
  return {
    unlockPractice,
    clearTapFeedback,
    resetAttempt,
    closePractice,
    requestClosePractice,
    focusPractice,
    undoTap,
    begin,
    loadNext,
    key,
    physical,
    finish,
    continueResult,
    know,
    restart,
  };
}
