
REVOKE EXECUTE ON FUNCTION public.is_platform_admin(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_brand_member(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_brand_owner(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_brand_manager_or_owner(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_location_access(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_manage_location(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_brand(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
