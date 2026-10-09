/** Decorative reveal only: assignment selection and persistence happen before this module is called. */
const rotations = new WeakMap();
const activeAnimations = new WeakMap();

function hashAngle(value) {
  let hash = 0;
  for (let index = 0; index < String(value || "").length; index += 1) hash = ((hash << 5) - hash + String(value)[index].charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}

function reducedMotionRequested() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function cancelWheel(wheelElement, reason = "cancelled") {
  const active = activeAnimations.get(wheelElement);
  if (!active) return;
  active.finish(reason);
}

export function revealCommittedResult(wheelElement, committedAssignment, { duration = 4800, onComplete = () => {} } = {}) {
  if (!wheelElement || !committedAssignment?.id) {
    onComplete("missing-target");
    return () => {};
  }
  cancelWheel(wheelElement, "replaced");
  const disc = wheelElement.querySelector(".wheel-disc") || wheelElement;
  const previous = rotations.get(wheelElement) || 0;
  const finalOffset = hashAngle(committedAssignment.id);
  const target = Math.ceil(previous / 360) * 360 + 5 * 360 + finalOffset;
  const motionDuration = reducedMotionRequested() ? 0 : Math.max(0, duration);
  let done = false;
  let timer = null;

  const finish = (reason = "completed") => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    disc.removeEventListener("transitionend", onTransitionEnd);
    activeAnimations.delete(wheelElement);
    rotations.set(wheelElement, target);
    disc.style.transition = "none";
    disc.style.transform = `rotate(${target}deg)`;
    onComplete(reason);
  };
  const onTransitionEnd = (event) => {
    if (event.target === disc && event.propertyName === "transform") finish("completed");
  };
  activeAnimations.set(wheelElement, { finish });
  disc.style.transition = "none";
  disc.style.transform = `rotate(${previous}deg)`;
  // Force style calculation so reduced/no-transition and rapid consecutive calls remain deterministic.
  void disc.offsetWidth;
  disc.addEventListener("transitionend", onTransitionEnd);
  if (motionDuration === 0) {
    disc.style.transform = `rotate(${target}deg)`;
    finish("reduced-motion");
  } else {
    disc.style.transition = `transform ${motionDuration}ms cubic-bezier(0.12, 0.72, 0.11, 1)`;
    disc.style.transform = `rotate(${target}deg)`;
    // A transition event can be suppressed by browser lifecycle changes; never leave the controller locked.
    timer = setTimeout(() => finish("timeout-fallback"), motionDuration + 650);
  }
  return () => finish("cancelled");
}
