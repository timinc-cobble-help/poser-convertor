const queryingFiles = {};

async function fetchFile(url) {
  const regex = /\/blob\/([0-9a-zA-Z.-]+)\/([a-z0-9A-Z./]+)\?*/;
  const match = url.match(regex);
  const [_, branch, filename] = match;

  const path = encodeURIComponent(filename);
  const key = JSON.stringify({ branch, path: filename });
  if (key in queryingFiles) {
    return queryingFiles[key];
  }
  const endpoint = `https://gitlab.com/api/v4/projects/cable-mc%2Fcobblemon/repository/files/${path}/raw?ref=${branch}`;
  const fetchIt = async () => {
    const response = await fetch(endpoint);
    const contents = await response.text();
    return contents;
  };
  const promise = await fetchIt();
  queryingFiles[key] = promise;
  return promise;
}

const collections = {
  FLYING_POSES: ["FLY", "HOVER"],
  SWIMMING_POSES: ["SWIM", "FLOAT"],
  STANDING_POSES: ["STAND", "WALK"],
  SHOULDER_POSES: ["SHOULDER_LEFT", "SHOULDER_RIGHT"],
  UI_POSES: ["PROFILE", "PORTRAIT"],
  MOVING_POSES: ["WALK", "SWIM", "FLY"],
  STATIONARY_POSES: ["STAND", "FLOAT", "HOVER"],
};

function getScale(type, input) {
  const regex = new RegExp(`override va[rl] ${type}Scale = (-*[0-9.]+)F`);
  const result = input.match(regex);
  return +result?.[1] || 1;
}

function getTranslation(type, input) {
  const regex = new RegExp(
    `override va[rl] ${type}Translation = Vec3\\w*\\((-*[0-9.]+), (-*[0-9.]+), (-*[0-9.]+)\\)`
  );
  const result = input.match(regex);
  if (result) {
    return [+result[1], +result[2], +result[3]];
  } else {
    return [0, 0, 0];
  }
}

function getPoseTypes(input) {
  const lineFinderRegex = /poseTypes* = [\s\S]+?,\n/;
  const line = input.match(lineFinderRegex)?.[0];
  const poseFinderRegex = /PoseType.[A-Z]+/g;
  const poseCollectionRegex = /[A-Z]+_[A-Z]+/g;
  const singlePoses =
    line.match(poseFinderRegex)?.map((pose) => pose.split(".")[1]) || [];
  const poses = singlePoses
    .concat(
      line
        .match(poseCollectionRegex)
        ?.flatMap((collection) => collections[collection])
    )
    .filter((e) => e);
  return poses;
}

function findInsideParentheses(startString) {
  const result = [];
  let i = startString.indexOf("(");
  while (startString[i]) {
    result.push(startString[i]);
    if (result.filter(e => e === "(").length > 0 && result.filter(e => e === "(").length === result.filter(e => e === ")").length) {
      return result.join("");
    }
    i++;
  }
}

const PLACEHOLDERS = {
  BipedWalkAnimation: {
    params: [
      "periodMultiplier",
      "amplitudeMultiplier"
    ],
    name: "biped_walk"
  },
  QuadrupedWalkAnimation: {
    params: [
      "periodMultiplier",
      "amplitudeMultiplier"
    ],
    name: "quadruped_walk"
  },
  BimanualSwingAnimation: {
    params: [
      "swingPeriodMultiplier",
      "amplitudeMultiplier"
    ],
    name: "bimanual_swing"
  },
  singleBoneLook: {
    params: [],
    name: "look"
  },
  bedrock: {
    params: [],
    name: "bedrock"
  }
}

function getAnimations(input) {
  const animations = [];
  const regex = /animations\s*=\s*arrayOf\([\s\S]*/;
  const matcher = findInsideParentheses(input.match(regex)?.[0]);
  if (!matcher) return [];
  console.log(matcher.match(new RegExp(``)));

  // for (const placeholderName in PLACEHOLDERS) {
  //   if (!matcher.includes(placeholderName)) continue;
  //   for (const param of PLACEHOLDERS[placeholderName].params) {
  //   }
  //   animations.push(`q.${PLACEHOLDERS[placeholderName].name}()`)
  // }
  return animations;
}

function getTransformTicks(input) {
  return +input.match(/transformTicks = ([0-9]+)/)?.[1] || undefined;
}

function getIsBattle(input) {
  const regex = /condition = { (!*)it.isBattling }/;
  const result = input.match(regex);
  if (!result) {
    return undefined;
  } else if (result[1]) {
    return false;
  } else {
    return true;
  }
}

function getPose(name, input) {
  const head = input.match(/override val head = getPart\("([a-z]+)"\)/)?.[1] || "head";
  const parts = { head }

  const regex = new RegExp(
    `${name}\\s*=\\s*registerPose\\((?:[^)(]+|\\((?:[^)(]+|\\([^)(]*\\))*\\))*\\)`
  );
  const matcher = input.match(regex)?.[0];
  if (!matcher) return null;
  const pose = {
    poseName: name,
    poseTypes: getPoseTypes(matcher),
    animations: getAnimations(matcher, parts),
    transformTicks: getTransformTicks(matcher),
    isBattle: getIsBattle(matcher),
  };
  if (pose.transformTicks === undefined) {
    delete pose.transformTicks;
  }
  if (pose.isBattle === undefined) {
    delete pose.isBattle;
  }
  return pose;
}

function getPoses(input) {
  const regex = /lateinit var ([a-zA-Z_]+): Pose/g;
  const poseNames = [...input.matchAll(regex)].map((e) => e[1]);
  const poseData = poseNames.map(name => getPose(name, input)).filter(e => e);
  return poseData.reduce((acc, data) => ({ ...acc, [data.poseName]: data }), {});
}

function getFaint(input) {
  const regex =
    /override fun getFaintAnimation\(\s*pokemonEntity: PokemonEntity,\s*state: PoseableEntityState<PokemonEntity>\s*\) = if \(state.isPosedIn\([\sa-z,]+?\)\) bedrockStateful\("([a-z]+)", "([a-z_]+)"\) else null/;
  const match = input.match(regex);
  if (!match) return undefined;
  return `bedrock(${match[1]}, ${match[2]})`;
}

function getCry(input) {
  const regex =
    /override val cryAnimation = CryProvider { _, _ -> bedrockStateful\("([a-z]+)", "([a-z_]+)"\) }/;
  const match = input.match(regex);
  if (!match) return undefined;
  return `bedrock(${match[1]}, ${match[2]})`;
}

function parseKtModel(input) {
  const result = {
    // head: input.match(/override val head = getPart\("([a-z]+)"\)/)?.[1],
    rootBone: input.match(/override val rootPart = root.registerChildWithAllChildren\("([a-z]+)"\)/)[1],
    portraitScale: getScale("portrait", input),
    portraitTranslation: getTranslation("portrait", input),
    profileScale: getScale("profile", input),
    profileTranslation: getTranslation("profile", input),
    poses: getPoses(input),
    faint: getFaint(input),
    cry: getCry(input),
  };
  if (result.faint === undefined) {
    delete result.faint;
  }
  if (result.cry === undefined) {
    delete result.cry;
  }

  return result;
}

let isBusy = false;
function markBusy() {
  ktForm
    .querySelector('button[type="submit"]')
    .setAttribute("aria-busy", "true");
  isBusy = true;
}

function markNonbusy() {
  ktForm.querySelector('button[type="submit"]').removeAttribute("aria-busy");
  isBusy = false;
}

function dlAsFile(name, data) {
  let elemx = document.createElement("a");
  elemx.href = "data:text/plain;charset=utf-8," + encodeURIComponent(data);
  elemx.download = name;
  elemx.style.display = "none";
  document.body.appendChild(elemx);
  elemx.click();
  document.body.removeChild(elemx);
}

const ktForm = document.querySelector("#kt-form");

ktForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (isBusy) return;
  markBusy();
  const ktSrc = ktForm.ktSrc.value;
  const ktFile = await fetchFile(ktSrc);
  const jsonVersion = parseKtModel(ktFile);
  markNonbusy();
  console.log(jsonVersion);
  // dlAsFile("test.json", JSON.stringify(jsonVersion, null, 2));
});
