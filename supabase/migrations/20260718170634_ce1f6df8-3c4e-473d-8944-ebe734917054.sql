DROP TRIGGER IF EXISTS trg_sync_client_no_show ON public.appointments;

UPDATE public.clients c
SET no_show_count = COALESCE(sub.cnt, 0)
FROM (
  SELECT cl.id AS client_id, COUNT(a.*) AS cnt
  FROM public.clients cl
  LEFT JOIN public.appointments a
    ON a.client_id = cl.id AND a.status = 'no_show'
  GROUP BY cl.id
) sub
WHERE c.id = sub.client_id
  AND c.no_show_count IS DISTINCT FROM COALESCE(sub.cnt, 0);