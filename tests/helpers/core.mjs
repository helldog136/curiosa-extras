import path from "node:path";
import { pathToFileURL } from "node:url";

// Les tests tournent dans le dossier de Curiosa (voir scripts/test.mjs) : ses aides de test (base jetable…) s'importent d'ici.
export const coreHelper = (name) => import(pathToFileURL(path.join(process.cwd(), "tests/helpers", name)).href);
