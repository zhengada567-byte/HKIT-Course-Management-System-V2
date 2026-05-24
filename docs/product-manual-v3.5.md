# HKIT Course Management System Product Manual V3.5

This document is the source of truth for the HKIT Course Management System.

Cursor and all AI coding assistants must follow this manual strictly.

## Critical Instructions for Implementation

1. Do not invent new roles.
2. Allowed roles are only:
   - programme_leader
   - admin
   - president

4. The most important business logic is natural combine:
   - same module_code + same module_term + same academic_year = natural combine
   - natural combine code = AUTO_{module_code}
   - student number input grouping key = academic_year + module_code + programme_code
   - same programme_code with different stream_code uses one student number entry
   - different programme_code keeps separate student number entries
   - natural combine does not require accept/reject
   - natural combined modules cannot be manually combined with other module codes

5. Approved loading teacher name must use:
   - teacher_title
   - teacher_family_name
   - teacher_other_name
   - teacher_name

6. Loading calculation must use teaching_status, not teacher employment_type.

7. TBC can be assigned but must not be stored in teachers and must not count in actual loading.

________________________________________
HKIT Course Management System
課程管理系統產品手冊 V3.5
1. 版本說明
本產品手冊 V3.5 是 HKIT Course Management System 的完整重構版規格文件，整合了全部已確認功能、補充規則與最新 natural combine 邏輯。
本版本包含：
•	三種角色：
•	Programme Leader
•	Admin
•	President

•	Programme Leader 使用共用帳號：
•	username: pl
•	password: pl
•	Programme Leader 可以查看及更改所有 programme。
•	Admin 可設定 academic year。
•	input: 2026
•	display: 2026/2027
•	Admin 可 upload initial data：
•	Programme
•	Teacher
•	Module
•	Approved Loading
•	President 負責：
•	edit approved teaching loading
•	confirm approved teaching loading
•	download approved loading PDF
•	網站部署於 Netlify。
•	Database 使用 Supabase PostgreSQL。
•	支援：
•	Desktop
•	iPad / Tablet
•	Phone / Mobile
•	Make Timetable 支援：
•	input student numbers
•	natural combine by same module code
•	manual combine for different module codes
•	split class
•	assign teacher
•	confirm assignment
•	actual loading calculation
•	支援 export：
• Admin 可下載 timetable Excel
• President 可下載 approved loading PDF
• Programme Leader 不可下載 timetable Excel

________________________________________
2. Project Overview
HKIT Course Management System 是一個學校內部使用的 web-based 課程管理、timetable preparation、teacher assignment 與 teacher workload tracking system。
系統主要用途：
•	User login
•	Role-based permission control
•	Academic year setting
•	Excel upload
•	Programme management
•	Teacher management
•	Module management
•	Course search
•	Timetable preparation
•	Natural combine module handling
•	Manual combine module workflow
•	Class split workflow
•	Teacher assignment
•	Actual loading calculation
•	Teacher loading review
•	Approved teaching loading approval
•	Excel / PDF export
•	Password management
•	Bilingual UI: 繁體中文 / English
________________________________________
3. Technical Architecture
Item	Technology / Requirement
Frontend	React + Vite
Language	TypeScript
UI	Tailwind CSS
Routing	React Router
Excel Import / Export	xlsx
PDF Export	jsPDF + jspdf-autotable
Database	Supabase PostgreSQL
Hosting	Netlify
i18n	Custom translations object
Languages	繁體中文 / English
Default Language	繁體中文
Responsive Support	Desktop, iPad / Tablet, Phone / Mobile
________________________________________
4. Supabase Configuration
系統 database 使用 Supabase PostgreSQL。
4.1 Supabase Project
Copy
Supabase Project URL:
https://edgaqkxmmzmrzdvtclel.supabase.co
Copy
Supabase Publishable Key:
sb_publishable_CUZE4YVeYdTuTJaM1cf1Aw_VzLlvgiw
________________________________________
4.2 Environment Variables
Frontend 必須透過 Vite environment variables 連接 Supabase。
.env：
Copy
VITE_SUPABASE_URL=https://nutmiqbgnqdoeijzyunt.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51dG1pcWJnbnFkb2Vpanp5dW50Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzNzM4MzMsImV4cCI6MjA5NDk0OTgzM30.fueDeI75Gh61_FszSe4BEfHnTWIl65qFqLvL8ZeGYhk
Netlify Environment Variables 也需加入相同設定：
Copy
VITE_SUPABASE_URL=https://nutmiqbgnqdoeijzyunt.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51dG1pcWJnbnFkb2Vpanp5dW50Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzNzM4MzMsImV4cCI6MjA5NDk0OTgzM30.fueDeI75Gh61_FszSe4BEfHnTWIl65qFqLvL8ZeGYhk
________________________________________
4.3 Supabase Client
Recommended file:

src/lib/supabase.ts

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  throw new Error("Missing VITE_SUPABASE_URL");
}

if (!supabaseAnonKey) {
  throw new Error("Missing VITE_SUPABASE_ANON_KEY");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
________________________________________

4.4 Supabase Security Rules

The Supabase publishable key may be used in the frontend through environment variables.

Never expose the Supabase service_role key in frontend code, repository, Netlify public variables, or browser logs.

RLS should be enabled on application tables where direct client access is used.

Because the system uses custom users in app_users, sensitive write operations should be protected by:
- application-level role checks; and
- Supabase RPC functions or controlled database policies where practical.

Unauthorized users must not be able to modify data by bypassing the UI.

________________________________________
5. Netlify Deployment
網站需部署於 Netlify。
5.1 Build Settings
Copy
Build command: npm run build
Publish directory: dist
________________________________________
5.2 SPA Redirect
因為系統使用 React Router，Netlify 必須設定 SPA redirect。
建立：
Copy
public/_redirects
內容：
Copy
/* /index.html 200
或使用 netlify.toml：
Copy
[build]
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
________________________________________
6. Responsive Design Requirements
系統必須支援：
Copy
Desktop
iPad / Tablet
Phone / Mobile
________________________________________
6.1 Desktop
Desktop 是 admin、data management、teacher loading 等資料密集頁面的主要使用場景。
建議：
•	full-width tables
•	compact filters
•	sticky table headers
•	multi-column forms
•	dashboard cards
Target:
Copy
1366px and above
________________________________________
6.2 iPad / Tablet
Tablet 需支援舒適操作。
建議：
•	two-column layout
•	scrollable tables
•	collapsible filters
•	larger touch targets
•	timetable workflow cards
Target:
Copy
768px – 1024px
________________________________________
6.3 Phone / Mobile
Mobile 需保持基本功能可用，尤其：
•	Login
•	Dashboard
•	Course Search
•	Teacher Loading
建議：
•	single-column layout
•	card-based display
•	horizontal table scroll
•	sticky action buttons
•	larger button touch area
Target:
Copy
375px – 767px
________________________________________
6.4 Page-level Responsive Rules
Page	Desktop	iPad / Tablet	Phone
Login	Center card	Center card	Full-width compact card
Dashboard	Grid cards	2-column cards	1-column cards
Course Search	Filter row + table	Stacked filters + table	Stacked filters + cards / scroll
Teacher Loading	Full table	Scrollable table	Cards + horizontal scroll
Upload Excel	Multi-panel	Stacked panels	Stacked compact panels
Data Management	Full CRUD table	Scrollable table	Search + cards / scroll
Make Timetable	Stepper + table	Stepper + cards	Stepper + card workflow
Split Class	Table controls	Cards / table	Card controls
Assign Teacher	Table + dropdowns	Cards / table	Card assignment
President Approved Loading	Editable table	Scrollable table	Cards / horizontal scroll
________________________________________
7. User Roles and Login
7.1 Roles
系統共有三種角色。
Role	Username	Default Password	Main Permissions
Programme Leader	pl	pl	管理 programmes、timetable、combine、split、assign teacher Review loading
Admin	admin	admin	Upload data、set academic year、manage initial data、change PL/Admin password 管理 programmes、timetable、combine、split、assign teacher Review loading

President	president	president	Review loading、edit/confirm approved loading、download PDF
________________________________________
7.2 Role Naming Rule
系統內部 role 必須使用：
Copy
export type UserRole = "programme_leader" | "admin" | "president";

Display labels may be Programme Leader, Admin, and President.
Database and code values must always be programme_leader, admin, and president.

________________________________________
7.3 Login Page
Login page 需包含：
•	system title
•	username input
•	password input
•	login button
•	language switcher
•	error message
所有角色均需 username + password 登入。
________________________________________
7.4 Password Storage
Password 不可寫死在 frontend code。
Password 應儲存在 Supabase database，並使用 hash。
建議使用：
Copy
pgcrypto
________________________________________
7.5 Password Management
Role	Can Change
Admin	Programme Leader password, Admin password
President	Own password
Programme Leader	暫不提供自己改 password
________________________________________
8. Permission Matrix
Function	Programme Leader	Admin	President
Dashboard	Yes	Yes	Yes
Course Search	Yes	Yes	Yes
Teacher Loading	Yes	Yes	Yes
Upload Excel	No	Yes	No
Academic Year Setting	No	Yes	No
Programme Management	Yes	Yes	View
Teacher Management	Create during assignment	Yes	View
Module Management	Adjust year/term	Yes	View
Make Timetable	Yes	Yes	No
Input Student Numbers	Yes	Yes	View
Natural Combine Review	Yes	Yes	View
Manual Combine Modules	Yes	Yes	View
Split Class	Yes	Yes	View
Assign Teacher	Yes	Yes	View
Confirm Assignment	Yes	Yes	View
Upload Initial Approved Loading	No	Yes	No
Edit Approved Loading	No	No	Yes
Confirm Approved Loading	No	No	Yes
Download Timetable Excel	No	Yes	No
Download Approved Loading PDF	No	No	Yes
Change PL/Admin Password	No	Yes	No
Change President Password	No	No	Yes
Unauthorized access must redirect to:
Copy
/dashboard
________________________________________
9. Academic Year Rules
Admin 可設定 academic start year。
Example:
Copy
Input: 2026
Display: 2026/2027
Previous Academic Year: 2025/2026
Academic year applies to:
•	teachers
•	module adjustments
•	timetable planning
•	student numbers
•	combine groups
•	timetable modules
•	teaching assignments
•	teacher actual loading
•	approved loading
•	export reports
Helper:
Copy
export function formatAcademicYear(startYear: number) {
  return `${startYear}/${startYear + 1}`;
}
________________________________________
10. Database Design
主要 tables：
Copy
app_users
app_settings
programmes
teachers
modules
module_adjustments
timetable_planning_modules
timetable_student_numbers
combine_groups
combine_group_modules
timetable_modules
teaching_assignments
teacher_actual_loading
approved_loading
export_logs
________________________________________
10.1 app_users
Stores login users and password hashes.
Field	Type	Required	Description
id	uuid	Yes	Primary key
username	text	Yes	Unique
role	text	Yes	programme_leader / admin / president
password_hash	text	Yes	Hashed password
created_at	timestamp	No	Created time
updated_at	timestamp	No	Updated time
Unique key:
Copy
username
Default users:
username	role	default password
pl	programme_leader	pl
admin	admin	admin
president	president	president
________________________________________
10.2 app_settings
Stores system settings.
Field	Type	Required	Description
key	text	Yes	Primary key
value	text	Yes	Setting value
updated_at	timestamp	No	Updated time
Example:
key	value
academic_start_year	2026
________________________________________
10.3 programmes
Stores programme master data.
Unique key:
Copy
programme_code + programme_stream
If stream is empty, store:
Copy
nil
Field	Type	Required	Description
id	uuid	Yes	Primary key
programme_type	text	Yes	HD / Degree
programme_code	text	Yes	Programme Code
programme_name	text	No	Programme Name
programme_stream	text	Yes	Empty becomes nil
programme_leader	text	No	Optional, not used for permission restriction
created_at	timestamp	No	Created time
updated_at	timestamp	No	Updated time
________________________________________
10.4 teachers
Stores teacher master data per academic year.
Teacher name is generated from:
Copy
title + family_name + other_name
Example:
title	family_name	other_name	teacher_name
Dr	Chan	Tai Man	Dr Chan Tai Man
Mr	Leung	Ray	Mr Leung Ray
Unique key:
Copy
teacher_name + academic_year
Field	Type	Required	Description
id	uuid	Yes	Primary key
title	text	No	Dr / Mr / Ms
family_name	text	Yes	Family Name
other_name	text	No	Other Name
teacher_name	text	Yes	Generated display name
employment_type	text	No	FT / PT
academic_year	text	Yes	e.g. 2026/2027
created_at	timestamp	No	Created time
updated_at	timestamp	No	Updated time
Helper:
Copy
export function buildTeacherName(
  title?: string | null,
  familyName?: string | null,
  otherName?: string | null
) {
  return [title, familyName, otherName]
    .map(value => String(value ?? "").trim())
    .filter(Boolean)
    .join(" ");
}
TBC rule:
Copy
TBC is not stored in teachers table.
________________________________________
10.5 modules
Stores module master data.
Unique key:
Copy
module_code + programme_code + stream_code + module_term
Reason:
•	同一 module 不會同時存在 Year 1 和 Year 2；
•	但同一 module 可能出現在不同 term；
•	所以 module_term 是 key 的一部分。
Field	Type	Required	Description
id	uuid	Yes	Primary key
module_code	text	Yes	Module Code
module_name	text	No	Module Name
module_year	text	No	Year 1 / Year 2 / Year 3
module_term	text	Yes	Sep / Feb / Jun
programme_code	text	Yes	Programme Code
stream_code	text	Yes	Empty becomes nil
created_at	timestamp	No	Created time
updated_at	timestamp	No	Updated time
Combined module information is not stored here as fixed master data.
________________________________________
10.6 module_adjustments
Stores PL adjusted module year / module term for a specific academic year.
Unique key:
Copy
module_id + academic_year
Field	Type	Required	Description
id	uuid	Yes	Primary key
module_id	uuid	Yes	FK to modules
academic_year	text	Yes	Academic year
adjusted_module_year	text	No	Adjusted year
adjusted_module_term	text	No	Adjusted term
updated_by	text	No	PL username
created_at	timestamp	No	Created time
updated_at	timestamp	No	Updated time
Display priority:
Copy
adjusted_module_year > modules.module_year
adjusted_module_term > modules.module_term
________________________________________
10.7 timetable_planning_modules
Stores Make Timetable planning module rows per academic year.
This table preserves every original module row, including different stream rows.
Unique key:
Copy
academic_year + module_id
Field	Type	Required	Description
id	uuid	Yes	Primary key
academic_year	text	Yes	Academic year
module_id	uuid	Yes	FK to modules
programme_code	text	Yes	Programme code
stream_code	text	Yes	Stream
module_code	text	Yes	Snapshot
module_name	text	No	Snapshot
module_year	text	No	Adjusted/current year
module_term	text	Yes	Adjusted/current term
natural_combine_code	text	No	AUTO_module_code if same code
manual_combine_group_id	uuid	No	FK to manual combine group
split_status	text	No	not_started / no_split / split
assignment_status	text	No	not_started / assigned / confirmed
created_by	text	No	PL
created_at	timestamp	No	Created time
updated_at	timestamp	No	Updated time
Important:
Copy
Student numbers are not stored directly here in V3.5.
They are stored in timetable_student_numbers.
________________________________________
10.8 timetable_student_numbers
Stores expected / actual student numbers by academic year + module code + programme code.
This table supports natural combine rules.
Unique key:
Copy
academic_year + module_code + programme_code
Field	Type	Required	Description
id	uuid	Yes	Primary key
academic_year	text	Yes	Academic year
module_code	text	Yes	Module Code
programme_code	text	Yes	Programme Code
expected_student_number	integer	Yes	Required
actual_student_number	integer	No	Optional
created_by	text	No	PL
created_at	timestamp	No	Created time
updated_at	timestamp	No	Updated time
Rules:
Copy
Different programme_code with same module_code keeps separate student numbers.

Same programme_code with different stream_code uses one student number entry.
________________________________________
10.9 combine_groups
Stores both natural combine and manual combine groups.
Unique key:
Copy
academic_year + combined_code + module_term
Field	Type	Required	Description
id	uuid	Yes	Primary key
academic_year	text	Yes	Academic year
combined_code	text	Yes	Generated code
combine_type	text	Yes	natural_same_module_code / manual
module_term	text	Yes	Sep / Feb / Jun
total_expected_student_number	integer	No	Calculated/cache
total_actual_student_number	integer	No	Calculated/cache
actual_student_number_status	text	No	complete / incomplete
status	text	No	pending / accepted / rejected / confirmed / auto_confirmed
created_by	text	No	PL/system
confirmed_at	timestamp	No	Confirmed time
created_at	timestamp	No	Created time
updated_at	timestamp	No	Updated time
Natural combine status:
Copy
auto_confirmed
Manual combine status:
Copy
pending / accepted / rejected / confirmed
________________________________________
10.10 combine_group_modules
Stores modules included in a combine group.
Unique key:
Copy
combine_group_id + planning_module_id
Field	Type	Required	Description
id	uuid	Yes	Primary key
combine_group_id	uuid	Yes	FK to combine_groups
planning_module_id	uuid	Yes	FK to timetable_planning_modules
academic_year	text	Yes	Academic year
programme_code	text	Yes	Programme
stream_code	text	Yes	Stream
module_code	text	Yes	Module Code
acceptance_status	text	No	pending / accepted / rejected / auto_confirmed
accepted_by	text	No	PL
accepted_at	timestamp	No	Accepted time
created_at	timestamp	No	Created time
updated_at	timestamp	No	Updated time
For natural combine:
Copy
acceptance_status = auto_confirmed
________________________________________
10.11 timetable_modules
Stores generated module instances after split decision.
A timetable module instance may come from:
•	single module planning row
•	natural combine group
•	manual combine group
Unique key:
Copy
academic_year + module_instance_code + module_term
programme_code and stream_code are retained for filtering and traceability, but module_instance_code + module_term identifies the timetable instance within an academic year.

Field	Type	Required	Description
id	uuid	Yes	Primary key
academic_year	text	Yes	Academic year
planning_module_id	uuid	No	Single module source
combine_group_id	uuid	No	Natural or manual combine source
programme_code	text	Yes	Programme code
stream_code	text	Yes	Stream or combined stream indicator
base_module_code	text	No	Original module code
combined_code	text	No	Combined code
combine_type	text	No	natural_same_module_code / manual / none
module_instance_code	text	Yes	BUS101 / AUTO_BUS101 / AUTO_BUS101_1
module_name	text	No	Module or combined display name
module_year	text	No	Year
module_term	text	Yes	Sep / Feb / Jun
mode	text	No	Day / Night / Saturday. Selected during assignment workflow and stored per timetable module instance.
expected_student_number	integer	No	From student number grouping
actual_student_number	integer	No	From student number grouping
split_group_size	integer	No	Number of classes
split_confirmed	boolean	No	Split decision completed
assignment_confirmed	boolean	No	Assignment confirmed
confirmed_version	integer	No	Latest version
created_by	text	No	PL
created_at	timestamp	No	Created time
updated_at	timestamp	No	Updated time
For natural combined group, programme_code and stream_code may store:
Copy
programme_code = MIXED
stream_code = MIXED
if multiple programmes/streams are included.

Each timetable module instance has one mode only.
Mode is exported in the Teacher Assignments sheet.

________________________________________
10.12 teaching_assignments
Stores teacher assignment for each timetable module instance.
Important distinction:
Concept	Meaning
Teacher Employment Status	老師本學年身份
Teaching Status for This Module	此科計算 loading 時使用的身份
Loading calculation uses:
Copy
teaching_status
not teacher employment type.
Field	Type	Required	Description
id	uuid	Yes	Primary key
timetable_module_id	uuid	Yes	FK to timetable_modules
academic_year	text	Yes	Academic year
teacher_name	text	Yes	Teacher name or TBC
teacher_title	text	No	Snapshot
teacher_family_name	text	No	Snapshot
teacher_other_name	text	No	Snapshot
teacher_employment_type	text	No	Snapshot
teaching_status	text	Yes	FT / PT
programme_type	text	No	HD / Degree snapshot
combined_code	text	No	Combined group code
combine_type	text	No	natural_same_module_code / manual / none
module_instance_code	text	Yes	Instance code
module_term	text	Yes	Term
assignment_version	integer	No	Version
confirmed	boolean	No	Latest confirmation
confirmed_at	timestamp	No	Confirmed time
updated_by	text	No	PL
created_at	timestamp	No	Created time
updated_at	timestamp	No	Updated time
TBC rule:
Copy
teacher_name = TBC
Then:
•	may be saved in teaching_assignments;
•	must not be saved in teachers;
•	must not be counted in actual loading.
Unique key:
timetable_module_id + assignment_version

Only latest confirmed assignment version is used for actual loading calculation and export.

________________________________________
10.13 teacher_actual_loading
Stores latest confirmed actual loading snapshot.
President sees latest confirmed version only.
Grouping key:
Copy
teacher_name + academic_year + module_term + teaching_status
Field	Type	Required	Description
id	uuid	Yes	Primary key
teacher_name	text	Yes	Teacher
academic_year	text	Yes	Academic year
module_term	text	Yes	Sep / Feb / Jun
teaching_status	text	Yes	FT / PT
teacher_employment_type	text	No	Annual employment snapshot
actual_loading	numeric	Yes	Term actual loading
hd_module_count	numeric	No	HD count
degree_module_count	numeric	No	Degree count
source_confirmed_version	integer	No	Assignment version
confirmed_by	text	No	PL
confirmed_at	timestamp	No	Confirmed time
updated_at	timestamp	No	Updated time
________________________________________
10.14 approved_loading
Stores approved maximum teaching loading per teacher per academic year.
Admin uploads initial values only.
President edits and confirms afterwards.
Approved loading teacher name uses same structure as teachers table:
Copy
teacher_title + teacher_family_name + teacher_other_name
Generated:
Copy
teacher_name
Unique key:
Copy
teacher_name + academic_year
Field	Type	Required	Description
id	uuid	Yes	Primary key
teacher_title	text	No	Dr / Mr / Ms
teacher_family_name	text	Yes	Family Name
teacher_other_name	text	No	Other Name
teacher_name	text	Yes	Generated teacher name
academic_year	text	Yes	Academic year
sep_term_approved_max_loading	numeric	No	Sep approved loading
feb_term_approved_max_loading	numeric	No	Feb approved loading
jun_term_approved_max_loading	numeric	No	Jun approved loading
confirmed	boolean	No	Confirmed by President
confirmed_at	timestamp	No	Confirmed time
updated_by	text	No	President
created_at	timestamp	No	Created time
updated_at	timestamp	No	Updated time
Annual approved loading is calculated automatically:
Copy
annual_approved_loading =
Sep + Feb + Jun
Annual approved loading should not be manually input.
Empty / null term values count as 0 for annual approved loading calculation.

________________________________________
10.15 export_logs
Optional but recommended.
Purpose:
| Field | Type | Required | Description |
|---|---|---:|---|
| id | uuid | Yes | Primary key |
| export_type | text | Yes | timetable_excel / approved_loading_pdf |
| academic_year | text | Yes | Academic year |
| programme_code | text | No | Optional programme filter |
| stream_code | text | No | Optional stream filter |
| exported_by | text | Yes | Username |
| exported_at | timestamp | Yes | Export time |

________________________________________
11. Excel Upload Rules
Admin upload page supports initial upload of:
•	Programme
•	Teacher
•	Module
•	Approved Loading
The old “only upload list of module Excel” function must be removed.
________________________________________
11.1 Programme Upload
Excel Field	Database Field	Required
Programme Type	programme_type	Yes
Programme Code	programme_code	Yes
Programme Name	programme_name	No
Programme Stream	programme_stream	Yes, empty → nil
Programme Leader	programme_leader	No
Upsert key:
Copy
programme_code + programme_stream
________________________________________
11.2 Teacher Upload
Excel Field	Database Field	Required
Title	title	No
Family Name	family_name	Yes
Other Name	other_name	No
Employment Type	employment_type	No
Academic Year	academic_year	Auto from admin setting
System generates:
Copy
teacher_name = title + family_name + other_name
Upsert key:
Copy
teacher_name + academic_year
________________________________________
11.3 Module Upload
Excel Field	Database Field	Required
Module Code	module_code	Yes
Module Name	module_name	No
Module Year	module_year	No
Module Term	module_term	Yes
Programme Code	programme_code	Yes
Stream Code	stream_code	Yes, empty → nil
Upsert key:
Copy
module_code + programme_code + stream_code + module_term
________________________________________
11.4 Approved Loading Upload
Approved loading upload uses separated teacher name fields.
Excel Field	Database Field	Required
Title	teacher_title	No
Family Name	teacher_family_name	Yes
Other Name	teacher_other_name	No
Teacher Name	teacher_name	Optional/generated
Sep Term Approved Max Loading	sep_term_approved_max_loading	No
Feb Term Approved Max Loading	feb_term_approved_max_loading	No
Jun Term Approved Max Loading	jun_term_approved_max_loading	No
Academic Year	academic_year	Auto from admin setting
System generates:
Copy
teacher_name = teacher_title + teacher_family_name + teacher_other_name
Upsert key:
Copy
teacher_name + academic_year
Admin uploads initial values only.
________________________________________
12. Course Search Page
All users can access Course Search.
Course Search displays module master data with PL adjusted module year / term applied.
________________________________________
12.1 Filter Flow
User filters:
1.	Programme Type
2.	Programme Code
3.	Programme Stream
4.	Display Modules
________________________________________
12.2 Display Data Source
Base data:
Copy
modules
Override data:
Copy
module_adjustments
Priority:
Copy
adjusted_module_year > modules.module_year
adjusted_module_term > modules.module_term
________________________________________
12.3 Display Columns
Column	Description
Module Code	module_code
Module Name	module_name
Module Year	adjusted or original
Module Term	adjusted or original
________________________________________
12.4 Sorting
Sort by:
Copy
module_year
module_term
module_code
Order:
Copy
Year 1 Sep
Year 1 Feb
Year 1 Jun
Year 2 Sep
Year 2 Feb
Year 2 Jun
Year 3 Sep
Year 3 Feb
Rows with the same module year + module term should share the same background color.
________________________________________
12.5 Programme Leader Editing
Programme Leader can edit:
•	module year
•	module term
Changes are stored in:
Copy
module_adjustments
Course Search updates immediately after save.
________________________________________
13. Programme Leader Make Timetable Workflow
Programme Leader can manage all programmes.
Workflow:
Copy
Select Programme / Stream
→ Load Modules
→ System applies Natural Combine
→ Input Student Numbers
→ Manual Combine Different Module Codes if needed
→ Confirm Combine
→ Split Class
→ Assign Teacher
→ Confirm Assignment
→ Generate Actual Loading
________________________________________
13.1 Step 1: Select Programme / Stream
PL selects:
•	programme type
•	programme code
•	programme stream
System loads modules for the selected programme / stream and also detects natural combine modules using same module code.
________________________________________
13.2 Step 2: Natural Combine Detection
System automatically detects same module_code under:
•	different programme_code
•	same programme_code but different stream_code
Natural combine grouping key:
Copy
academic_year + module_code + module_term
Natural combined code:
Copy
AUTO_{module_code}
Example:
Copy
AUTO_BUS101
Natural combine does not require manual setup or accept/reject.
________________________________________
13.3 Step 3: Input Student Numbers
Expected student number is required before combine / split.
Actual student number is optional.
Student number input grouping key:
Copy
academic_year + module_code + programme_code
This means:
Situation	Student Number Input
Same module_code, different programme_code	One input per programme_code
Same module_code, same programme_code, different stream_code	One input per programme_code only
Same module_code, same programme_code, same stream_code	One input
________________________________________
13.4 Student Number Validation
Field	Required	Rule
expected_student_number	Yes	Must be valid number
actual_student_number	No	Can be empty
Validation:
Copy
expected_student_number >= 0
actual_student_number >= 0 or empty
If expected student number is missing:
Copy
Cannot continue to combine / split step.
________________________________________
14. Natural Combine Rules
Natural combine is system-generated combine based on same module code.
________________________________________
14.1 Natural Combine Core Rule
If multiple module records share same:
Copy
module_code
and same:
Copy
module_term
within the same academic year, they are naturally combined.
Applies even if they have different:
Copy
programme_code
stream_code
Natural combine grouping:
Copy
academic_year + module_code + module_term

Natural combined code is AUTO_{module_code}.
If the same module_code appears in different terms, the same natural combined code may appear in multiple terms.
Therefore, the unique identity of a natural combine group is:
academic_year + combined_code + module_term.

________________________________________
14.2 Different Programme Code Rule
If same module_code appears under different programme_code:
Copy
module_code same
programme_code different
System displays one natural combined group.
But student numbers must be kept separately by programme_code.
Example:
Module Code	Programme Code	Stream Code
BUS101	HDHC	nil
BUS101	HDEE	nil
Student number input:
Combined Code	Module Code	Programme Code	Expected Student Number	Actual Student Number
AUTO_BUS101	BUS101	HDHC	30	28
AUTO_BUS101	BUS101	HDEE	25	24
Combined total:
Combined Code	Total Expected	Total Actual
AUTO_BUS101	55	52
________________________________________
14.3 Same Programme Different Stream Rule
If same module_code appears under same programme_code but different stream_code:
Copy
module_code same
programme_code same
stream_code different
System displays one natural combined group.
But PL only inputs one expected / actual student number for that programme_code.
Example:
Module Code	Programme Code	Stream Code
BUS101	HDHC	A
BUS101	HDHC	B
BUS101	HDHC	C
Student number input:
Combined Code	Module Code	Programme Code	Streams Included	Expected Student Number	Actual Student Number
AUTO_BUS101	BUS101	HDHC	A, B, C	60	55
________________________________________
14.4 Student Number Input Granularity
For natural combine, student number input is grouped by:
Copy
academic_year + module_code + programme_code
Stream code is ignored for student number input within the same programme_code.
However, stream information must still be retained for:
•	Course Search
•	Programme filtering
•	Excel export
•	timetable traceability
________________________________________
14.5 Natural Combine Student Number Calculation
For a natural combined group:
Copy
combined_expected_student_number =
sum(expected_student_number from timetable_student_numbers)
where:
Copy
academic_year = current academic year
module_code = target module code
Actual calculation:
Copy
If all related programme_code entries have actual_student_number:
  combined_actual_student_number = sum(actual_student_number)
  actual_student_number_status = complete

If any related programme_code entry has empty actual_student_number:
  combined_actual_student_number = null
  actual_student_number_status = incomplete
________________________________________
14.6 Natural Combine Status
Natural combine status is:
Copy
auto_confirmed
No accept / reject is needed.
________________________________________
14.7 Natural Combine and Manual Combine Priority
Natural combine has priority over manual combine.
Final rule:
Copy
Auto/natural-combined modules cannot be manually combined with other module codes.
Reason:
•	avoids nested combine groups;
•	avoids confusing loading calculation;
•	makes UI simpler;
•	prevents duplicate or under-counted loading.
________________________________________
15. Manual Combine Module Rules
Manual combine is used only for different module codes that are not already naturally combined.
________________________________________
15.1 Same-term Rule
Only modules in the same module term can be manually combined.
Allowed:
Copy
BUS101 Sep + MGT202 Sep
Not allowed:
Copy
BUS101 Sep + MGT202 Feb
________________________________________
15.2 Manual Combined Code Generation
System generates combined code by sorting module codes alphabetically and joining with _.
Example:
Copy
BUS101 + MGT202 → BUS101_MGT202
Three modules:
Copy
ACC101_BUS101_MGT202
________________________________________
15.3 Manual Combined Student Numbers
For each manual combined group, system displays:
•	combined code
•	total expected student number
•	total actual student number
•	actual number status
Calculation uses relevant timetable_student_numbers.
Copy
total_expected_student_number =
sum(expected_student_number)
Actual:
Copy
If all actual_student_number values exist:
  total_actual_student_number = sum(actual_student_number)
  status = complete

If any actual_student_number is empty:
  total_actual_student_number = null
  status = incomplete
________________________________________
15.4 Cross-programme Manual Combine
If a module is manually combined with another programme’s module:
•	the other module appears automatically in its programme timetable workflow;
•	system shows Accept Combine / Reject Combine;
•	combine remains pending until accepted.
Even though all PL users share one pl account, this accept flow is retained as workflow confirmation.
________________________________________
15.5 Manual Combine Status
Status	Meaning
pending	Waiting for affected modules/programmes
accepted	Module accepted combine
rejected	Module rejected combine
confirmed	All related modules accepted
Split class cannot start unless manual combine status is:
Copy
confirmed
________________________________________
16. Split Class Workflow
Split class happens after natural combine / manual combine confirmation.
________________________________________
16.1 Split Target
Split target can be:
•	single module
•	natural combined module group
•	manual combined module group
________________________________________
16.2 Split Eligibility
Split is allowed only when:
Copy
expected student number > 40
For single module:
Copy
expected_student_number > 40
For natural combined module:
Copy
total_expected_student_number > 40
For manual combined module:
Copy
total_expected_student_number > 40
Actual student number is not used for split eligibility because it can be empty.
________________________________________
16.3 No Split
If student number is not greater than 40:
Copy
No split allowed.
System creates one timetable module instance.
Single module:
Copy
BUS101
Natural combined module:
Copy
AUTO_BUS101
Manual combined module:
Copy
BUS101_MGT202
________________________________________
16.4 Split Class Count
If split is allowed, PL must input:
Copy
number_of_classes
Example:
Copy
2
System generates instance codes from 1.
Single module:
Copy
BUS101_1
BUS101_2
Natural combined module:
Copy
AUTO_BUS101_1
AUTO_BUS101_2
Manual combined module:
Copy
BUS101_MGT202_1
BUS101_MGT202_2
________________________________________
16.5 Cancel Split
Split can be cancelled if teacher assignment has not been completed.
If teacher has already been assigned:
Copy
PL must go back to assignment step and remove assignments before changing split.
________________________________________
16.6 Split Completion
Even if PL chooses no split, PL must confirm split decision.
Only after split decision is completed can PL assign teachers.
________________________________________
17. Assign Teacher Workflow
Assign teacher starts after split decision.
________________________________________
17.1 Assignment Target
Assignment target is timetable module instance.
Examples:
Copy
BUS101
BUS101_1
BUS101_2
AUTO_BUS101
AUTO_BUS101_1
AUTO_BUS101_2
BUS101_MGT202
BUS101_MGT202_1
BUS101_MGT202_2
________________________________________
17.2 Required Assignment Fields
Field	Required	Description
mode	Yes	Day / Night / Saturday
teacher	Yes	Teacher or TBC
teaching_status	Yes	FT / PT
________________________________________
17.3 Mode Options
Copy
Day
Night
Saturday
Each module instance has one mode.
________________________________________
17.4 Teacher Selection
PL can:
•	select teacher from teachers table;
•	create new teacher;
•	choose TBC.
Teacher dropdown displays:
Copy
Title + Family Name + Other Name - Employment Status
Example:
Copy
Dr Chan Tai Man - FT
________________________________________
17.5 Create Teacher
When creating teacher, PL enters:
•	title
•	family_name
•	other_name
•	employment_type
System generates:
Copy
teacher_name
Academic year is current academic year.
TBC cannot be created as a teacher record.
________________________________________
17.6 Teaching Status for This Module
PL must select:
Copy
FT
PT
This determines which loading filter counts the module.
Important distinction:
UI Label	Meaning
Teacher Employment Status	老師本學年身份
Teaching Status for This Module	此科計算 loading 時使用的身份
Example:
Copy
Teacher Employment Status = FT
Teaching Status for This Module = PT
This module is counted under PT loading, not FT loading.
________________________________________
18. Confirm Assignment and Recalculation
18.1 Confirm Assignment
When PL confirms assignments, system must:
1.	save teaching assignments;
2.	mark assignments as confirmed;
3.	increment confirmed version;
4.	calculate actual loading;
5.	update teacher_actual_loading snapshot.
________________________________________
18.2 Edit After Confirm
PL can edit after confirm.
When PL clicks Edit:
•	assignment becomes editable;
•	latest confirmed actual loading remains visible until re-confirm;
•	after PL re-confirms, system recalculates actual loading;
•	President sees latest confirmed version only.
________________________________________
19. Actual Loading Calculation
Actual loading is calculated from latest confirmed teaching assignments.
________________________________________
19.1 Exclude TBC
If:
Copy
teacher_name = TBC
then:
•	do not count loading;
•	do not create teacher_actual_loading record.
________________________________________
19.2 Teaching Status Based
Actual loading is grouped by:
Copy
teaching_status
not teacher employment type.
Example:
Teacher	Employment Type	Teaching Status	Counted Under
Mike	FT	FT	FT
Mike	FT	PT	PT
Amy	PT	PT	PT
Amy	PT	FT	FT
________________________________________
19.3 Combined Module Priority
Natural and manual combined module rules have highest priority.
________________________________________
19.4 Non-split Natural Combined Module
If natural combined module is not split, multiple assignments with same:
Copy
teacher_name
combined_code
module_term
teaching_status
count as:
Copy
1 loading
Example:
Assignment	Teacher	Count
AUTO_BUS101	Mike	1
Even if AUTO_BUS101 includes several programmes/streams, it counts once for that teacher.
________________________________________
19.5 Split Natural Combined Module
If natural combined module is split, each split instance counts separately.
Loading key:
Copy
teacher_name
combined_code
module_instance_code
module_term
teaching_status
Example:
Instance	Teacher	Teaching Status	Count
AUTO_BUS101_1	Mike	FT	1
AUTO_BUS101_2	Mike	FT	1
Total:
Copy
2
________________________________________
19.6 Non-split Manual Combined Module
If manual combined module is not split, multiple assignments with same:
Copy
teacher_name
combined_code
module_term
teaching_status
count as:
Copy
1 loading
________________________________________
19.7 Split Manual Combined Module
If manual combined module is split, each split instance counts separately.
Loading key:
Copy
teacher_name
combined_code
module_instance_code
module_term
teaching_status
________________________________________
19.8 Single Module
If no combine:
Copy
Each confirmed timetable module instance counts as 1 loading.
________________________________________
19.9 Term Loading
System calculates each teacher’s loading by term:
•	Sep
•	Feb
•	Jun
________________________________________
19.10 Annual Loading
Annual actual loading is calculated as:
Copy
annual_actual_loading =
Sep actual + Feb actual + Jun actual
________________________________________
19.11 HD / Degree Summary
System displays:
•	HD module count
•	Degree module count
Programme type comes from programme data or assignment snapshot.
________________________________________
20. Teacher Loading Page
All users can view Teacher Loading.
________________________________________
20.1 Filters
Teacher Loading page supports:
•	Academic Year
•	Teaching Status:
•	FT
•	PT
•	Teacher Search, optional
•	Programme Type, optional
________________________________________
20.2 FT View Columns
When filter = FT:
Column	Description
Teacher Name	Generated teacher name
Teacher Employment Status	Annual status
Sep Actual Loading	Current year Sep loading
Sep Approved Loading	President-approved
Feb Actual Loading	Current year Feb loading
Feb Approved Loading	President-approved
Jun Actual Loading	Current year Jun loading
Jun Approved Loading	President-approved
Annual Actual Loading	Sep + Feb + Jun actual
Annual Approved Loading	Sep + Feb + Jun approved
Previous Year Annual Actual	Previous year total
HD Modules	HD count
Degree Modules	Degree count
________________________________________
20.3 PT View Columns
When filter = PT:
Column	Description
Teacher Name	Generated teacher name
Teacher Employment Status	Annual status
Sep Actual Loading	Current year Sep loading
Feb Actual Loading	Current year Feb loading
Jun Actual Loading	Current year Jun loading
Annual Actual Loading	Sep + Feb + Jun actual
Previous Year Annual Actual	Previous year total
HD Modules	HD count
Degree Modules	Degree count
PT view does not show approved loading.
________________________________________
20.4 Previous Year Comparison
If current academic year is:
Copy
2026/2027
previous year is:
Copy
2025/2026
Teacher Loading page reads previous year actual loading from:
Copy
teacher_actual_loading
________________________________________
21. Approved Loading Workflow
Approved loading is controlled by Admin initial upload and President confirmation.
________________________________________
21.1 Admin Initial Upload
Admin can upload initial approved loading values:
•	Sep approved max loading
•	Feb approved max loading
•	Jun approved max loading
Admin should not be final editor after initial upload.
________________________________________
21.2 Approved Loading Teacher Name Structure
Approved loading stores teacher name in separated fields:
•	teacher_title
•	teacher_family_name
•	teacher_other_name
•	teacher_name
Generated:
Copy
teacher_name =
teacher_title + teacher_family_name + teacher_other_name
Example:
Title	Family Name	Other Name	Teacher Name
Mr	Leung	Ray	Mr Leung Ray
Dr	Chan	Tai Man	Dr Chan Tai Man
________________________________________
21.3 President Edit
President can edit:
•	Sep approved max loading
•	Feb approved max loading
•	Jun approved max loading
________________________________________
21.4 President Confirm
Edit does not become final until President clicks:
Copy
Confirm Approved Loading
On confirm, system saves:
•	confirmed = true
•	confirmed_at
•	updated_by
•	updated_at
________________________________________
21.5 Annual Approved Loading
Annual approved loading is calculated:
Sep + Feb + Jun

Empty / null values count as 0.

It should not be manually input.

________________________________________
22. Export / Download Functions
系統需支援兩類 download / export：
| Export Type | User Role | Format | Purpose |
|---|---|---|---|
| Timetable Export | Admin | Excel .xlsx | Download completed Make Timetable result |
| Approved Loading Export | President | PDF .pdf | Download approved teaching loading report |

________________________________________
22.1 Make Timetable Excel Export
Access Control

| Role | Can Download |
|---|---:|
| Programme Leader | No |
| Admin | Yes |
| President | No |


Button Visibility

Programme Leader:
- must not see Download Timetable Excel button.

Admin:
- can see Download Timetable Excel button after assignment is confirmed.

President:
- must not see Download Timetable Excel button.


________________________________________
Export Timing
For Admin, the Excel download button should be available only after:
Assignment Confirmed
Programme Leader and President must not see the Timetable Excel download button.

If assignment is not confirmed:
System must block download and show:
Please confirm assignment before downloading timetable Excel.

________________________________________
File Name
Recommended:
Copy
HKIT_Timetable_{academic_year}_{programme_code}_{stream_code}.xlsx
Example:
Copy
HKIT_Timetable_2026-2027_HDHC_nil.xlsx
All programmes:
Copy
HKIT_Timetable_2026-2027_All_Programmes.xlsx
________________________________________
Excel Sheets
Sheet Name	Content
Summary	Export metadata
Modules	Original and adjusted module info
Student Numbers	Expected / actual student numbers grouped by module_code + programme_code
Combined Modules	Natural and manual combine groups
Split Classes	Split / no split result
Teacher Assignments	Assigned teacher and teaching status
________________________________________
Summary Sheet
Column	Description
Academic Year	e.g. 2026/2027
Programme Code	Programme Code
Programme Stream	Stream
Exported By	username
Exported At	timestamp
Assignment Status	confirmed / pending
Confirmed Version	latest confirmed version
________________________________________
Modules Sheet
Column	Source
Programme Code	modules / planning
Stream Code	modules / planning
Module Code	modules.module_code
Module Name	modules.module_name
Original Module Year	modules.module_year
Original Module Term	modules.module_term
Adjusted Module Year	module_adjustments.adjusted_module_year
Adjusted Module Term	module_adjustments.adjusted_module_term
Final Module Year	adjusted or original
Final Module Term	adjusted or original
Natural Combine Code	AUTO_module_code if applicable
________________________________________
Student Numbers Sheet
Column	Source / Description
Academic Year	timetable_student_numbers.academic_year
Module Code	timetable_student_numbers.module_code
Programme Code	timetable_student_numbers.programme_code
Streams Included	list from planning modules
Expected Student Number	timetable_student_numbers.expected_student_number
Actual Student Number	timetable_student_numbers.actual_student_number
Natural Combined Code	AUTO_module_code if applicable
________________________________________
Combined Modules Sheet
Column	Source
Combined Code	combine_groups.combined_code
Combine Type	natural_same_module_code / manual
Academic Year	combine_groups.academic_year
Module Term	combine_groups.module_term
Included Module Codes	combine_group_modules module list
Included Programmes	programme_code list
Included Streams	stream_code list
Student Number Grouping	module_code + programme_code
Combine Status	combine_groups.status
Total Expected Students	combine_groups.total_expected_student_number
Total Actual Students	combine_groups.total_actual_student_number
Actual Student Number Status	complete / incomplete
________________________________________
Split Classes Sheet
Column	Source
Academic Year	timetable_modules.academic_year
Programme Code	timetable_modules.programme_code
Stream Code	timetable_modules.stream_code
Base Module Code	timetable_modules.base_module_code
Combined Code	timetable_modules.combined_code
Combine Type	timetable_modules.combine_type
Module Instance Code	timetable_modules.module_instance_code
Module Name	timetable_modules.module_name
Module Year	timetable_modules.module_year
Module Term	timetable_modules.module_term
Expected Students	timetable_modules.expected_student_number
Actual Students	timetable_modules.actual_student_number
Split Group Size	timetable_modules.split_group_size
Split Confirmed	timetable_modules.split_confirmed
________________________________________
Teacher Assignments Sheet
Column	Source
Academic Year	teaching_assignments.academic_year
Programme Code	joined from timetable_modules
Stream Code	joined from timetable_modules
Module Instance Code	teaching_assignments.module_instance_code
Module Term	teaching_assignments.module_term
Mode	timetable_modules.mode
Teacher Name	teaching_assignments.teacher_name
Teacher Title	teaching_assignments.teacher_title
Teacher Family Name	teaching_assignments.teacher_family_name
Teacher Other Name	teaching_assignments.teacher_other_name
Teacher Employment Status	teaching_assignments.teacher_employment_type
Teaching Status for This Module	teaching_assignments.teaching_status
Programme Type	teaching_assignments.programme_type
Combine Type	teaching_assignments.combine_type
Confirmed	teaching_assignments.confirmed
Confirmed At	teaching_assignments.confirmed_at
________________________________________
22.2 President Approved Loading PDF Export
Access Control
Role	Can Download
Programme Leader	No
Admin	No
President	Yes
________________________________________
Export Timing
President can download PDF after approved loading is confirmed.
If approved loading is not confirmed:
System must block download and show:
Please confirm approved loading before downloading PDF.

________________________________________
File Name
Copy
HKIT_Approved_Loading_{academic_year}.pdf
Example:
Copy
HKIT_Approved_Loading_2026-2027.pdf
________________________________________
PDF Content
PDF must include:
•	system title
•	report title
•	academic year
•	exported by
•	exported at
•	approved teaching loading table
•	confirmation status
•	confirmed at
•	confirmed by / updated by
________________________________________
PDF Footer

PDF footer must include:
- President signature line
- page number
If Chinese text is included in the PDF, jsPDF must load a Unicode font such as NotoSansTC.

________________________________________
PDF Header
Copy
HKIT Course Management System
Approved Teaching Loading Report
Academic Year: 2026/2027
________________________________________
PDF Table Columns
Column	Description
Teacher Name	teacher_name
Teacher Title	teacher_title
Teacher Family Name	teacher_family_name
Teacher Other Name	teacher_other_name
Sep Approved Loading	sep_term_approved_max_loading
Feb Approved Loading	feb_term_approved_max_loading
Jun Approved Loading	jun_term_approved_max_loading
Annual Approved Loading	Sep + Feb + Jun
Confirmed	confirmed
Confirmed At	confirmed_at
Updated By	updated_by
Updated At	updated_at
Annual approved loading calculation:
Copy
Annual = Sep + Feb + Jun
Empty values count as 0.
________________________________________
23. Data Management
23.1 Admin
Admin can manage initial data:
•	programmes
•	teachers
•	modules
•	initial approved loading
•	academic year
•	PL/Admin passwords
Admin can:
•	view
•	add
•	update
•	delete
•	upload Excel
________________________________________
23.2 Programme Leader
Programme Leader can manage operational planning data:
•	module adjustments
•	timetable planning modules
•	timetable student numbers
•	natural combine review
•	manual combine groups
•	split decisions
•	teaching assignments
________________________________________
23.3 President
President can:
•	view all data
•	edit approved loading
•	confirm approved loading
•	download approved loading PDF
•	change own password
________________________________________
24. i18n Requirements
System must support:
•	繁體中文
•	English
Default:
Copy
繁體中文
All visible UI text must use translation keys.
Suggested keys:
Copy
{
  programmeLeader: "Programme Leader",
  admin: "Admin",
  president: "President",
  academicYear: "Academic Year",
  programmeType: "Programme Type",
  programmeCode: "Programme Code",
  programmeStream: "Programme Stream",
  moduleCode: "Module Code",
  moduleName: "Module Name",
  moduleYear: "Module Year",
  moduleTerm: "Module Term",
  naturalCombine: "Natural Combine",
  manualCombine: "Manual Combine",
  naturalCombineCode: "Natural Combine Code",
  teacherName: "Teacher Name",
  teacherTitle: "Teacher Title",
  teacherFamilyName: "Teacher Family Name",
  teacherOtherName: "Teacher Other Name",
  teacherEmploymentStatus: "Teacher Employment Status",
  teachingStatusForThisModule: "Teaching Status for This Module",
  expectedStudentNumber: "Expected Student Number",
  actualStudentNumber: "Actual Student Number",
  combineModules: "Combine Modules",
  combinedCode: "Combined Code",
  combinedExpectedStudents: "Combined Expected Students",
  combinedActualStudents: "Combined Actual Students",
  acceptCombine: "Accept Combine",
  rejectCombine: "Reject Combine",
  splitClass: "Split Class",
  numberOfClasses: "Number of Classes",
  assignTeacher: "Assign Teacher",
  makeTimetable: "Make Timetable",
  confirmAssignment: "Confirm Assignment",
  actualLoading: "Actual Loading",
  approvedLoading: "Approved Loading",
  annualActualLoading: "Annual Actual Loading",
  annualApprovedLoading: "Annual Approved Loading",
  previousYearActualLoading: "Previous Year Actual Loading",
  downloadTimetableExcel: "Download Timetable Excel",
  downloadApprovedLoadingPdf: "Download Approved Loading PDF"
}
________________________________________
25. UI Style Requirements
Design should be:
•	simple
•	compact
•	clear
•	suitable for internal school intranet
•	professional
Suggested style:
UI Element	Style
Background	slate / white
Primary accent	HKIT-like blue
Success	soft green
Pending	amber
Warning	red
Secondary	muted purple or grey
Tables	compact rows, sticky headers if useful
Buttons	small, clear, high contrast
________________________________________
26. Acceptance Criteria
26.1 Login
•	pl / pl logs in as Programme Leader.
•	admin / admin logs in as Admin.
•	president / president logs in as President.
•	Password is stored as hash in database.
•	No role named normal / principal / principle.
________________________________________
26.2 Academic Year
•	Admin can set 2026.
•	System displays 2026/2027.
•	Previous year displays 2025/2026.
•	All planning/loading/export data uses current academic year.
________________________________________
26.3 Supabase / Netlify
•	Website deploys to Netlify.
•	Build command is npm run build.
•	Publish directory is dist.
•	SPA routes work after refresh.
•	Supabase URL and key are read from environment variables.
________________________________________
26.4 Responsive
•	Website works on desktop.
•	Website works on iPad / tablet.
•	Website works on phone.
•	Data-heavy tables have horizontal scroll or mobile card layout.
•	Buttons are touch-friendly.
________________________________________
26.5 Programme
•	programme_code + programme_stream is unique.
•	Empty stream becomes nil.
•	Programme Leader can view all programmes.
________________________________________
26.6 Teacher
•	Teacher name is generated from title + family_name + other_name.
•	TBC is not stored in teachers.
•	Teacher employment type can change by academic year.
•	teacher_name + academic_year is unique.
________________________________________
26.7 Module
•	module_code + programme_code + stream_code + module_term is unique.
•	Same module can exist in different terms.
•	Course Search uses adjusted year/term if available.
________________________________________
26.8 Course Search
•	All users can access.
•	Filter by programme type, programme code, programme stream.
•	Display module code, name, year, term.
•	Sort by year and term.
•	Same year + term has same background color.
•	PL adjusted module year/term is shown.
________________________________________
26.9 Natural Combine
•	Same module_code under different programme_code is automatically combined.
•	Same module_code under same programme_code but different stream_code is automatically combined.
•	Natural combine grouping key is academic_year + module_code + module_term.
•	Natural combine code is AUTO_module_code.
•	Natural combine does not require accept/reject.
•	Natural combine status is auto_confirmed.
•	Natural combine has priority over manual combine.
•	Natural-combined modules cannot be manually combined with other module codes.
________________________________________
26.10 Student Numbers
•	Expected student number is required.
•	Actual student number is optional.
•	Student number input grouping key is academic_year + module_code + programme_code.
•	Same module_code under different programme_code keeps separate expected / actual student numbers.
•	Same module_code under same programme_code but different stream_code only needs one expected / actual student number entry.
•	Stream code is retained for traceability but not used to split student number input within the same programme.
•	Cannot proceed to combine/split without expected student number.
________________________________________
26.11 Manual Combine
•	Only same-term modules can combine manually.
•	Manual combine is only for different module codes.
•	Natural-combined modules cannot be manually combined.
•	System generates sorted combined code.
•	Combined expected student number is sum of expected.
•	Combined actual shows incomplete if any actual is missing.
•	Cross-programme manual combine requires acceptance.
•	Split cannot start until manual combine is confirmed.
________________________________________
26.12 Split Class
•	Split allowed only if expected student number > 40.
•	Natural combine uses total expected student number > 40.
•	Manual combine uses total expected student number > 40.
•	PL inputs number of classes.
•	Single module split code: module_code_1, module_code_2.
•	Natural combine split code: AUTO_module_code_1, AUTO_module_code_2.
•	Manual combine split code: combined_code_1, combined_code_2.
•	Split can be cancelled before assignment.
•	Assignment can only start after split decision.
________________________________________
26.13 Assignment
•	Assignment target is timetable module instance.
•	Mode required: Day / Night / Saturday.
•	Teacher required: teacher or TBC.
•	Teaching status required: FT / PT.
•	TBC is not counted in loading.
________________________________________
26.14 Actual Loading
•	Based on latest confirmed assignments.
•	Uses teaching_status.
•	Natural/manual combined module rule has highest priority.
•	Non-split natural combined module counts once per teacher + combined_code + term + teaching_status.
•	Split natural combined module counts once per teacher + combined_code + module_instance_code + term + teaching_status.
•	Non-split manual combined module counts once per teacher + combined_code + term + teaching_status.
•	Split manual combined module counts once per teacher + combined_code + module_instance_code + term + teaching_status.
•	Single module instance counts once.
•	President sees latest confirmed version.
________________________________________
26.15 Teacher Loading
•	FT filter shows FT teaching_status only.
•	PT filter shows PT teaching_status only.
•	FT view shows approved loading.
•	PT view does not show approved loading.
•	Shows Sep / Feb / Jun actual loading.
•	Shows annual actual loading.
•	Shows previous year annual actual loading.
•	Shows HD / Degree summary.
________________________________________
26.16 Approved Loading
•	Admin uploads initial approved loading.
•	Approved loading stores teacher_title, teacher_family_name, teacher_other_name, teacher_name.
•	teacher_name is generated from teacher_title + teacher_family_name + teacher_other_name.
•	President edits approved loading.
•	President must confirm after edit.
•	Approved loading includes Sep / Feb / Jun.
•	Annual approved loading is calculated automatically.
•	Confirm saves updated_by / updated_at / confirmed_at.
________________________________________
26.17 Timetable Excel Export
• Programme Leader cannot download timetable Excel.
• Admin can download timetable Excel after assignment confirmed.
• President cannot download timetable Excel.
•	Excel includes:
•	module information
•	student numbers
•	natural combine information
•	manual combine information
•	split class information
•	assigned teacher information
•	Excel filename includes academic year and programme code.
•	If Admin tries to download before assignment is confirmed, download must be blocked.
System must show: Please confirm assignment before downloading timetable Excel.
• If export_logs is implemented, successful timetable Excel downloads are logged as timetable_excel.

________________________________________
26.18 Approved Loading PDF Export
•	President can download approved loading PDF.
•	PDF includes:
•	academic year
•	approved teaching loading
•	teacher title / family name / other name
•	term approved loading
•	annual approved loading
•	confirmed status
•	confirmed at
•	updated by
•	updated at
•	PDF filename includes academic year.
•	Unconfirmed approved loading must not be downloaded.
System must show: Please confirm approved loading before downloading PDF.
• If export_logs is implemented, successful approved loading PDF downloads are logged as approved_loading_pdf.

________________________________________
27. Core Development Principles
The system must follow these principles:
Copy
1. Use president, not principal or principle.

2. Programme Leader replaces Normal User.

3. Programme Leader uses shared pl account and can manage all programmes.

4. Website is deployed on Netlify.

5. Database is Supabase PostgreSQL.

6. Supabase URL and publishable key are configured through environment variables.

7. System must support desktop, iPad/tablet, and phone/mobile layouts.

8. Course Search displays module master data with PL adjusted year/term.

9. Teacher name is generated from title + family name + other name.

10. Approved loading teacher name also uses title + family name + other name.

11. Expected student number is required before combine or split.

12. Same module_code is naturally combined across programmes and streams.

13. Natural combine grouping key is academic_year + module_code + module_term.

14. Natural combine requires no manual setup and no accept/reject.

15. For natural combine, student number input is grouped by academic_year + module_code + programme_code.

16. Same programme_code with different streams only needs one expected/actual student number entry.

17. Different programme_code must keep separate expected/actual student number entries.

18. Natural combine has priority over manual combine.

19. Natural-combined modules cannot be manually combined with other module codes.

20. Only same-term different module codes can be manually combined.

21. Manual combine must be confirmed before split.

22. Split is allowed only when expected student number > 40.

23. Assignment can start only after split decision.

24. Loading calculation uses teaching_status, not teacher employment type.

25. Combined module rule has highest priority.

26. Split combined classes count separately.

27. TBC is allowed in assignment but excluded from actual loading.

28. President sees latest confirmed version only.

29. Admin uploads initial approved loading; President edits and confirms afterwards.

30. Admin can export confirmed timetable result as Excel.

31. Programme Leader cannot export timetable Excel.
32. President can export confirmed approved teaching loading as PDF.

________________________________________
28. Recommended Development Phases
Phase	Deliverable
Phase 1	Database schema, RLS, helper functions
Phase 2	Login, roles, password hash
Phase 3	Admin academic year setting
Phase 4	Excel upload and data management
Phase 5	Responsive layout foundation
Phase 6	Course Search with module adjustments
Phase 7	Make Timetable planning module generation
Phase 8	Natural combine detection and student number grouping
Phase 9	Manual combine workflow
Phase 10	Split class workflow
Phase 11	Assign teacher workflow
Phase 12	Confirm assignment and actual loading calculation
Phase 13	Teacher Loading page
Phase 14	President approved loading edit/confirm
Phase 15	Password management
Phase 16	Timetable Excel export
Phase 17	Approved Loading PDF export
Phase 18	i18n completion and UI polish
Phase 19	Netlify deployment and final testing
________________________________________
29. Final System Logic Summary
V3.5 的核心資料流是：
Copy
programmes
+ teachers
+ modules
→ module_adjustments
→ timetable_planning_modules
→ timetable_student_numbers
→ natural combine / manual combine
→ combine_groups
→ timetable_modules
→ teaching_assignments
→ teacher_actual_loading
→ teacher loading review
→ approved_loading
→ export reports
________________________________________
29.1 Natural Combine Summary
Copy
Same module_code + same module_term
= natural combine
Student number logic:
Copy
Different programme_code:
  keep separate student number entries

Same programme_code but different stream_code:
  use one student number entry
Input grouping:
Copy
academic_year + module_code + programme_code
Combine grouping:
Copy
academic_year + module_code + module_term
________________________________________
29.2 Loading Summary
Copy
TBC is ignored.
Teaching status determines FT/PT loading.
Natural/manual combine counts as one if not split.
Split combined classes count separately.
President only sees latest confirmed actual loading.
________________________________________
29.3 Export Summary
Admin:
  Download confirmed timetable Excel.

Programme Leader:
  Cannot download timetable Excel.

President:
  Download confirmed approved loading PDF.


