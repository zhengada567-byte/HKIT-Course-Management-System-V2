drop trigger if exists trg_teacher_actual_loading_updated_at
on public.teacher_actual_loading;

create trigger trg_teacher_actual_loading_updated_at
before update on public.teacher_actual_loading
for each row
execute function public.set_updated_at();
