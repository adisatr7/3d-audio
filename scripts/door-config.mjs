import { getDoorAudioConfig } from "./door-audio.mjs";
import { MODULE_ID } from "./spatial-audio.mjs";

const FIELDS = [
  { name: "enabled", type: "checkbox" },
  { name: "radius", type: "number", min: 0.1, step: "any" },
  { name: "volume", type: "number", min: 0, max: 1, step: 0.05 },
  { name: "easing", type: "checkbox" },
  { name: "walls", type: "checkbox" },
];

function createInput(app, field, value) {
  const name = `flags.${MODULE_ID}.door.${field.name}`;
  const id = `${app.id}-3d-audio-door-${field.name}`;
  const input = document.createElement("input");

  input.name = name;
  input.id = id;
  input.type = field.type;

  if (field.type === "checkbox") {
    input.dataset.dtype = "Boolean";
    input.checked = value;
  } else {
    input.dataset.dtype = "Number";
    input.value = value;

    for (const attribute of ["min", "max", "step"]) {
      if (field[attribute] !== undefined) {
        input.setAttribute(attribute, field[attribute]);
      }
    }
  }

  return input;
}

/** Extend the normal WallConfig form; core persists the submitted module flags. */
export function addDoorSoundConfig(app, element) {
  const nativeGroup = element
    .querySelector('[name="doorSound"]')
    ?.closest(".form-group");

  if (!nativeGroup || element.querySelector("[data-3d-audio-door]")) {
    return;
  }

  const config = getDoorAudioConfig(
    app.document,
    canvas.dimensions.distance * 12,
  );

  const fieldset = document.createElement("fieldset");
  fieldset.dataset["3dAudioDoor"] = "";

  const legend = document.createElement("legend");
  legend.textContent = game.i18n.localize("3d-audio.door.title");

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = game.i18n.localize("3d-audio.door.hint");

  fieldset.append(legend, hint);

  for (const field of FIELDS) {
    const group = document.createElement("div");
    group.className = "form-group";

    const label = document.createElement("label");
    label.textContent = game.i18n.localize(`3d-audio.door.${field.name}.label`);

    const fields = document.createElement("div");
    fields.className = "form-fields";

    const input = createInput(app, field, config[field.name]);
    label.htmlFor = input.id;

    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = game.i18n.localize(`3d-audio.door.${field.name}.hint`);

    fields.append(input);
    group.append(label, fields, hint);
    fieldset.append(group);
  }

  nativeGroup.insertAdjacentElement("afterend", fieldset);
  const doorType = element.querySelector('[name="door"]');

  const updateVisibility = () => {
    const isDoor =
      Number(doorType?.value ?? app.document.door) !==
      CONST.WALL_DOOR_TYPES.NONE;

    fieldset.hidden = !isDoor;

    // Disabled fields are not submitted; ordinary wall edits retain saved flags
    for (const input of fieldset.querySelectorAll("input")) {
      input.disabled = !isDoor;
    }
  };

  doorType?.addEventListener("change", updateVisibility);
  updateVisibility();
}
