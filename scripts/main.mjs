import {
  ENABLED_SETTING,
  MODULE_ID,
  reconcileActiveAmbientSounds,
  removeAllSpatializers,
  removeAmbientSpatializer,
  spatializeAmbientSound,
  updateSpatialPositions
} from "./spatial-audio.mjs";

const WRAPPED = Symbol.for("3d-audio.AmbientSound.applyEffects");

function installAmbientSoundEffectsWrapper() {
  const prototype = CONFIG.AmbientSound.objectClass.prototype;
  const original = prototype.applyEffects;

  if (original[WRAPPED]) {
    return;
  }

  function applyEffectsWithSpatialization(...args) {
    const result = original.apply(this, args);
    try {
      spatializeAmbientSound(this);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to spatialize Ambient Sound`, error);
    }
    return result;
  }

  Object.defineProperty(applyEffectsWithSpatialization, WRAPPED, {value: true});
  prototype.applyEffects = applyEffectsWithSpatialization;
}

function addAmbientSoundConfigCheckbox(app, element) {
  if (element.querySelector(`[name="flags.${MODULE_ID}.enabled"]`)) {
    return;
  }

  const group = document.createElement("div");
  group.className = "form-group";

  const label = document.createElement("label");
  label.textContent = "Enable 3D Audio";

  const fields = document.createElement("div");
  fields.className = "form-fields";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.name = `flags.${MODULE_ID}.enabled`;
  input.dataset.dtype = "Boolean";
  input.checked = app.document.getFlag(MODULE_ID, "enabled") !== false;

  fields.append(input);
  group.append(label, fields);

  // Keep the addition inside Foundry's existing Activation section.
  const wallsGroup = element.querySelector('[name="walls"]')?.closest(".form-group");
  if (wallsGroup) {
    wallsGroup.insertAdjacentElement("afterend", group);
  } else {
    element.querySelector(".standard-form")?.append(group);
  }
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, ENABLED_SETTING, {
    name: "Enable 3D Audio",
    hint: "Apply listener-relative HRTF spatialization to enabled canvas Ambient Sounds.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => reconcileActiveAmbientSounds()
  });

  installAmbientSoundEffectsWrapper();
});

Hooks.on("renderAmbientSoundConfig", addAmbientSoundConfigCheckbox);

Hooks.on("canvasReady", () => queueMicrotask(reconcileActiveAmbientSounds));

Hooks.on("canvasTearDown", () => removeAllSpatializers());

Hooks.on("controlToken", () => queueMicrotask(reconcileActiveAmbientSounds));

Hooks.on("updateToken", (document, changes) => {
  if (!document.object?.controlled) {
    return;
  }

  if (!("x" in changes) && !("y" in changes) && !("rotation" in changes)
    && !("width" in changes) && !("height" in changes)) {
    return;
  }

  updateSpatialPositions();
});

Hooks.on("updateAmbientSound", (document, changes) => {
  const ambient = document.object;
  if (!ambient) {
    return;
  }

  if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.enabled`)) {
    if (document.getFlag(MODULE_ID, "enabled") === false) {
      removeAmbientSpatializer(ambient);
    } else {
      reconcileActiveAmbientSounds();
    }
  }

  if (("x" in changes) || ("y" in changes)) {
    updateSpatialPositions();
  }
});

Hooks.on("deleteAmbientSound", (document) => {
  removeAmbientSpatializer(document.object, {forgetOwner: true});
});
