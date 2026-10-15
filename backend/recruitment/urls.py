"""
recruitment/urls.py – URL routing cho Recruitment module.
"""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import RecruitmentNeedViewSet, JobViewSet, JobChannelViewSet
from .candidate_views import CandidateViewSet
from .pipeline_views import (
    ApplicationViewSet,
    InterviewViewSet,
    InterviewEvaluationViewSet,
    OfferViewSet,
)

router = DefaultRouter()
router.register(r'needs', RecruitmentNeedViewSet, basename='recruitment-need')
router.register(r'jobs', JobViewSet, basename='recruitment-job')
router.register(r'job-channels', JobChannelViewSet, basename='recruitment-channel')
router.register(r'candidates', CandidateViewSet, basename='recruitment-candidate')
router.register(r'applications', ApplicationViewSet, basename='recruitment-application')
router.register(r'interviews', InterviewViewSet, basename='recruitment-interview')
router.register(r'evaluations', InterviewEvaluationViewSet, basename='recruitment-evaluation')
router.register(r'offers', OfferViewSet, basename='recruitment-offer')

urlpatterns = [
    path('', include(router.urls)),
]
