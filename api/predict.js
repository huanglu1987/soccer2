"use strict";

const { computeRulePrediction } = require("../lib/predictor");

module.exports = function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Only POST is supported." });
    return;
  }

  try {
    const prediction = computeRulePrediction(req.body?.rows);
    res.status(200).json(prediction);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Prediction failed."
    });
  }
};
