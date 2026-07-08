import { Elysia } from "elysia";
import { treaty } from "@elysiajs/eden";

const app = new Elysia()
  .get("/llm", () => "llms")
  .get("/llm/:id", ({ params }) => params.id)
  .post("/llm/:id/default", ({ params }) => params.id);

const api = treaty(app);
console.log(Object.keys(api.llm));
