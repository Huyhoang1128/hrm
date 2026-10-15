from django.contrib import admin

from .models import Team, TeamInvitation, TeamMembership


@admin.register(Team)
class TeamAdmin(admin.ModelAdmin):
	list_display = ('name', 'code', 'owner', 'visibility', 'is_active', 'invite_code', 'created_at')
	list_filter = ('visibility', 'is_active', 'created_at')
	search_fields = ('name', 'code', 'owner__username', 'owner__first_name', 'owner__last_name')
	readonly_fields = ('invite_code', 'created_at', 'updated_at')


@admin.register(TeamMembership)
class TeamMembershipAdmin(admin.ModelAdmin):
	list_display = ('team', 'user', 'role', 'status', 'is_default_team', 'joined_at')
	list_filter = ('role', 'status', 'is_default_team', 'team')
	search_fields = ('team__name', 'user__username', 'employee__full_name', 'employee__employee_id')
	readonly_fields = ('created_at', 'updated_at')


@admin.register(TeamInvitation)
class TeamInvitationAdmin(admin.ModelAdmin):
	list_display = ('team', 'email', 'role', 'status', 'invite_code', 'expires_at', 'accepted_at')
	list_filter = ('status', 'role', 'team')
	search_fields = ('team__name', 'email', 'invite_code', 'token')
	readonly_fields = ('invite_code', 'token', 'created_at', 'updated_at')
