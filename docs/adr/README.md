# Architecture Decision Records

The decisions in force for Lastro. Each is one file; change a decision by
editing its file in the same change that changes the code, and add a new
number for a new decision.

| ADR | Decision |
|---|---|
| [1](0001-persistence.md) | PostgreSQL Is the Source of Truth |
| [2](0002-four-records.md) | Four Financial Records and Their Settlements |
| [3](0003-book-tenancy.md) | The Book Is the Tenancy Boundary |
| [4](0004-money.md) | Money Is a Bigint in Minor Units |
| [5](0005-derived-status.md) | Status Is Derived from Active Settlements |
| [6](0006-signed-items.md) | Deductions and Discounts Are Signed Items |
| [7](0007-stated-amounts.md) | Expenses and Revenues State Their Amount |
| [8](0008-accounts-and-parties.md) | Accounts Are Money the Book Controls; Everyone Else Is a Party |
| [9](0009-runtime.md) | Runtime and Tooling |
| [10](0010-ui.md) | A Quiet Review Interface |
| [11](0011-modules.md) | Vertical Business Modules |
| [12](0012-operations.md) | One Operation Definition, Derived Surfaces, One Write Envelope |
| [13](0013-evidence.md) | Imports Stage Evidence; Parsers Return Observations |
| [14](0014-files-and-types.md) | One File Ledger, Consumers and Types Named for Their Movements |
| [15](0015-identity-and-keys.md) | Every Line Has an External Key; Every Link Names Its Destination |
| [16](0016-descriptor-decides.md) | The Descriptor Decides Everything |
| [17](0017-statement-lines.md) | Statement Lines Post When Fully Mapped; Transfers Meet by Key |
| [18](0018-cards.md) | A Card Purchase Is One Expense and Its Instalments |
| [19](0019-revenue-movements.md) | A Day's Sales by Method Are Revenue Movements |
| [20](0020-money-in-settles-sales.md) | Money In Settles the Day's Sales |
| [21](0021-sales.md) | Sales Are Sale Movements, Posted by Product |
