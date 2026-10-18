import { v1Json, v1Options } from "@/lib/api-v1/http";
import { openApiDocument } from "../_lib/openapi";
import { origin, v1Route } from "../_lib/route";

// GET /api/v1/openapi.json — OpenAPI 3.1 description of every /api/v1 endpoint.
export const GET = v1Route((req) => v1Json(openApiDocument(origin(req))));

export const OPTIONS = v1Options;
