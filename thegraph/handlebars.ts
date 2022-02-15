import fs from "fs";
import Handlebars from "handlebars";

const json = fs.readFileSync("config.json").toString();
const template = fs.readFileSync("subgraph.hbs.yaml").toString();
const compiler = Handlebars.compile(template);
const subgraph = compiler(JSON.parse(json));

fs.writeFileSync("subgraph.yaml", subgraph);
