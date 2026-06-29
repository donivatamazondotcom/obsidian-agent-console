import { afterEach, describe, it, expect } from "vitest";
import * as React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import { CarriedOverPreview } from "../CarriedOverPreview";

const data = {
	fromAgent: "Claude",
	turns: [
		{ role: "user" as const, text: "First question" },
		{ role: "assistant" as const, text: "First answer" },
	],
};

afterEach(cleanup);

describe("CarriedOverPreview", () => {
	it("renders the source agent and the carried turns", () => {
		render(<CarriedOverPreview data={data} />);
		expect(screen.getByText("Carried over from Claude")).toBeTruthy();
		expect(screen.getByText("First question")).toBeTruthy();
		expect(screen.getByText("First answer")).toBeTruthy();
	});

	it("uses a native, keyboard-accessible <button> for the collapse toggle", () => {
		render(<CarriedOverPreview data={data} />);
		const toggle = screen.getByRole("button");
		// A native <button> gets Enter/Space activation and the focus ring for
		// free (keyboard-first tenet) — no hand-rolled key handling needed.
		expect(toggle.tagName).toBe("BUTTON");
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
	});

	it("collapses (hides the turns) when the header is activated", () => {
		render(<CarriedOverPreview data={data} />);
		expect(screen.queryByText("First question")).toBeTruthy();

		fireEvent.click(screen.getByRole("button"));

		expect(screen.queryByText("First question")).toBeNull();
		expect(
			screen.getByRole("button").getAttribute("aria-expanded"),
		).toBe("false");
	});
});
