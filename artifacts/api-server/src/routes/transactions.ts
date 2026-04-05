import { Router, type IRouter } from "express";
import { getAllTransactions } from "../lib/db.js";

const router: IRouter = Router();

router.get("/transactions", (_req, res) => {
  const transactions = getAllTransactions();
  res.json({ transactions });
});

export default router;
