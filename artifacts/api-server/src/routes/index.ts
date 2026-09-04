import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import meRouter from "./me";
import memberRouter from "./member";
import leaderRouter from "./leader";
import presidentRouter from "./president";
import { attachMember } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.use(healthRouter);

// Resolves the Clerk session (if any) to a PMC member record for every
// request under /api. Individual routers then decide what to require
// (requireMember / requireRole) -- this just makes req.member available.
router.use(attachMember);

router.use(memberRouter); // public verification profile -- no member gate
router.use("/auth", authRouter);
router.use("/me", meRouter);
router.use("/leader", leaderRouter);
router.use("/president", presidentRouter);

export default router;
