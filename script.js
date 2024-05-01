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
  console.log(input, result);
  return +result?.[1] || 1;
}

function getTranslation(type, input) {
  const regex = new RegExp(
    `override va[rl] ${type}Translation = Vec3d\\((-*[0-9.]+), (-*[0-9.]+), (-*[0-9.]+)\\)`
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

function getAnimations(input) {
  const regex = new RegExp(
    "idleAnimations\\s*=\\s*arrayOf\\(((?:[^)(]+|\\((?:[^)(]+|\\([^)(]*\\))*\\))*)\\)"
  );
  const matcher = input.match(regex)?.[1];
  const bedrockMatcher = /(bedrock\("[a-z]+", "[a-z_]+"\))/g;
  const bedrockMatches = [...matcher.matchAll(bedrockMatcher)].map((match) =>
    match[0].replaceAll('"', "")
  );
  const daLook = matcher.includes("singleBoneLook") ? ["look"] : [];
  return bedrockMatches.concat(daLook);
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
  const regex = new RegExp(
    `${name}\\s*=\\s*registerPose\\((?:[^)(]+|\\((?:[^)(]+|\\([^)(]*\\))*\\))*\\)`
  );
  const matcher = input.match(regex)?.[0];
  const pose = {
    poseName: name,
    poseTypes: getPoseTypes(matcher),
    animations: getAnimations(matcher),
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
  const regex = /lateinit var ([a-z]+): PokemonPose/g;
  const poseNames = [...input.matchAll(regex)].map((e) => e[1]);
  return poseNames.reduce(
    (acc, name) => ({ ...acc, [name]: getPose(name, input) }),
    {}
  );
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
    head: input.match(/override val head = getPart\("([a-z]+)"\)/)?.[1],
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
  dlAsFile("test.json", JSON.stringify(jsonVersion, null, 2));
  markNonbusy();
});
