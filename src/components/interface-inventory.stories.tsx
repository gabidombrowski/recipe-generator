import type { Meta, StoryObj } from "@storybook/nextjs";
import { Badge, Button, Empty, Input, PageTitle, Select, Spinner, Textarea } from "~/components/atoms";
import { Card, DayPicker, Field, FieldAction, InfoHint, MacroRow } from "~/components/molecules";
import { DAYS_OF_WEEK } from "~/lib/schemas";

/**
 * The interface inventory.
 *
 * Frost's chapter 4 recommends auditing every unique UI pattern in one place as
 * the way to see inconsistency rather than argue about it. This is that audit,
 * kept live: every variant of every atom and molecule on one screen, so a
 * palette or spacing change is judged against all of them at once rather than
 * by hunting for the screens that happen to use the rare ones.
 *
 */
const meta = {
  title: "Interface inventory",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every button variant, including the states that are easy to forget. */
export const Buttons: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled>
          Primary disabled
        </Button>
        <Button variant="secondary" disabled>
          Secondary disabled
        </Button>
      </div>
      <p className="text-xs text-ink-muted">
        Primary uses <code>accent-ink</code> rather than white — accent is dark
        in the light theme and light in the dark one, so a fixed foreground
        fails one of them. Switch the background above to check both.
      </p>
    </div>
  ),
};

export const Badges: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge>neutral</Badge>
      <Badge tone="accent">accent</Badge>
      <Badge tone="training">training</Badge>
      <Badge tone="warn">warn</Badge>
      <Badge tone="flagged">flagged</Badge>
    </div>
  ),
};

/** The plate motif, which is the app's one unmistakable visual move. */
export const Titles: Story = {
  render: () => (
    <div className="space-y-6">
      <div>
        <PageTitle>Grocery</PageTitle>
        <p className="text-sm text-ink-muted">
          Shopping day: <strong>Monday</strong> · week of August 2, 2026
        </p>
      </div>
      <PageTitle subdued>Week of 2026-08-02</PageTitle>
      <p className="text-xs text-ink-muted">
        The subdued variant exists for headings that are mostly data — a date
        set in an uppercase display face reads badly.
      </p>
    </div>
  ),
};

export const Cards: Story = {
  render: () => (
    <div className="max-w-2xl space-y-4">
      <Card title="Today's targets">
        <MacroRow kcal={1725} proteinG={172} carbsG={105} fatG={69} />
      </Card>
      <Card title="With an action" action={<Button>Do something</Button>}>
        <p className="text-sm">
          The heading is a section plate; the action sits on its baseline.
        </p>
      </Card>
      <Card>
        <Empty>Nothing here yet.</Empty>
      </Card>
    </div>
  ),
};

/**
 * Form controls in a row.
 *
 * The alignment here is the point: a row of fields is top-aligned so that a
 * field carrying a hint does not sit its input a line higher than one without.
 * `FieldAction` reserves a label-sized box so a bare button lands on the same
 * baseline as the inputs.
 */
export const FormRow: Story = {
  render: () => (
    <div className="flex flex-wrap items-start gap-3 rounded-lg border border-border p-3">
      <Field label="Rule type">
        <Select defaultValue="tag_cap">
          <option value="tag_cap">Tag limit</option>
          <option value="note">Note</option>
        </Select>
      </Field>
      <Field label="Tag">
        <Input placeholder="fermented" className="w-36" />
      </Field>
      <Field label="Max per recipe" hint="optional">
        <Input type="number" className="w-28" />
      </Field>
      <Field label="Max per week" hint="optional">
        <Input type="number" className="w-28" />
      </Field>
      <FieldAction>
        <Button variant="primary">Add rule</Button>
      </FieldAction>
    </div>
  ),
};

export const Controls: Story = {
  render: () => (
    <div className="max-w-md space-y-4">
      <Field label="Text" hint="A hint sits under the control">
        <Input defaultValue="Some value" />
      </Field>
      <Field label="Select">
        <Select defaultValue="b">
          <option value="a">First</option>
          <option value="b">Second</option>
        </Select>
      </Field>
      <Field label="Textarea" hint="Monospace, for free-text config">
        <Textarea rows={3} defaultValue={"- a note\n- another"} />
      </Field>
    </div>
  ),
};

/**
 * The hint is revealed on hover *and* keyboard focus — tab to the "i" to check
 * the focus path, which is the one people forget.
 */
export const Hints: Story = {
  render: () => (
    <p className="flex items-center gap-2 text-sm">
      Grocery copy format
      <InfoHint>
        Markdown pastes into GitHub, Obsidian or Notion as tickable checkboxes.
        Change it under Settings.
      </InfoHint>
    </p>
  ),
};

export const Days: Story = {
  render: () => (
    <Field label="Cook days" hint="Cook double; next day is a leftover day">
      <DayPicker
        days={DAYS_OF_WEEK}
        selected={["Tuesday", "Thursday"]}
        onChange={() => undefined}
      />
    </Field>
  ),
};

export const Loading: Story = {
  render: () => (
    <div className="max-w-md space-y-4">
      <Spinner />
      <Spinner label="Asking Claude" />
    </div>
  ),
};
