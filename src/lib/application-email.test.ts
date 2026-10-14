import { describe, expect, it } from "vitest";

import { emailAddresses, emailParts, emailUnits, isEmailAddress, mailtoHref } from "./application-email";

describe("the email's parts", () => {
  it("reads and builds the units, a missing part empty", () => {
    expect(emailParts([{ id: "subject", label: "Subject", text: "Hello" }])).toEqual({ to: "", subject: "Hello", body: "" });
    expect(emailUnits({ to: "a@b.eu", subject: "Hi", body: "Text" })).toEqual([
      { id: "to", label: "Recipient", text: "a@b.eu" },
      { id: "subject", label: "Subject", text: "Hi" },
      { id: "body", label: "Message", text: "Text" },
    ]);
  });
});

describe("email addresses", () => {
  it("finds the addresses in a recipient line", () => {
    expect(emailAddresses("Anna Berg <anna.berg@ledgerly.eu>")).toEqual(["anna.berg@ledgerly.eu"]);
    expect(emailAddresses("jobs@ledgerly.eu, Anna <anna@ledgerly.eu>; jobs@ledgerly.eu")).toEqual(["jobs@ledgerly.eu", "anna@ledgerly.eu"]);
    expect(emailAddresses("The hiring team")).toEqual([]);
  });

  it("tells an address from anything else", () => {
    expect(isEmailAddress("anna@ledgerly.eu")).toBe(true);
    expect(isEmailAddress("Anna <anna@ledgerly.eu>")).toBe(false);
    expect(isEmailAddress("anna@ledgerly")).toBe(false);
    expect(isEmailAddress("anna@ledgerly.eu.")).toBe(false);
  });
});

describe("mailtoHref", () => {
  it("fills in the addresses, subject and message, with CRLF line breaks (RFC 6068)", () => {
    expect(mailtoHref({ to: "Anna Berg <anna+jobs@ledgerly.eu>", subject: "Application: Designer & more", body: "Dear Anna,\n\nHello." })).toBe(
      "mailto:anna%2Bjobs@ledgerly.eu?subject=Application%3A%20Designer%20%26%20more&body=Dear%20Anna%2C%0D%0A%0D%0AHello.",
    );
  });

  it("leaves out what's empty", () => {
    expect(mailtoHref({ to: "", subject: "", body: "" })).toBe("mailto:");
    expect(mailtoHref({ to: "The team", subject: "Hi", body: " " })).toBe("mailto:?subject=Hi");
  });
});
