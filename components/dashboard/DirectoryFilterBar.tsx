import { DirectorySearchField } from "@/components/dashboard/DirectorySearchField";

type FilterOption = {
  label: string;
  value: string;
};

type DirectoryFilterBarProps = {
  action: string;
  query: string;
  status: string;
  statusOptions: FilterOption[];
  // Optional extras for clients page
  dateFrom?: string;
  dateTo?: string;
  showDateRange?: boolean;
};

export function DirectoryFilterBar({
  action,
  query,
  status,
  statusOptions,
  dateFrom = "",
  dateTo = "",
  showDateRange = false,
}: DirectoryFilterBarProps) {
  return (
    <form action={action} className={showDateRange ? "filterBar filterBar--dates" : "filterBar"}>
      <DirectorySearchField defaultValue={query} />

      <label className="filterField">
        <span>Status</span>
        <select name="status" defaultValue={status} className="filterSelect">
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {showDateRange && (
        <>
          <label className="filterField">
            <span>From</span>
            <input
              type="date"
              name="from"
              defaultValue={dateFrom}
              className="filterInput"
            />
          </label>
          <label className="filterField">
            <span>To</span>
            <input
              type="date"
              name="to"
              defaultValue={dateTo}
              className="filterInput"
            />
          </label>
        </>
      )}

      <div className="filterActions">
        <button type="submit" className="filterButton">
          Apply
        </button>
        <a href={action} className="textLink">
          Clear
        </a>
      </div>
    </form>
  );
}
