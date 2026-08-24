"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const action_1 = require("./action");
const github_1 = require("./github");
(0, action_1.runAction)().catch(github_1.setFailed);
