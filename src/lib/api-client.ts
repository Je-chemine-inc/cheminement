/**
 * API Client Utility
 * Provides helper functions for making API calls with proper error handling
 */

import type { AppointmentResponse } from "@/types/api";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

interface FetchOptions extends RequestInit {
  data?: any;
}

class ApiClient {
  private baseURL: string;

  constructor(baseURL: string = "/api") {
    this.baseURL = baseURL;
  }

  private async request<T>(
    endpoint: string,
    options: FetchOptions = {},
  ): Promise<T> {
    const { data, ...fetchOptions } = options;

    const config: RequestInit = {
      ...fetchOptions,
      headers: {
        "Content-Type": "application/json",
        ...fetchOptions.headers,
      },
    };

    if (data) {
      config.body = JSON.stringify(data);
    }

    try {
      const response = await fetch(`${this.baseURL}${endpoint}`, config);

      if (!response.ok) {
        let body: {
          error?: string;
          details?: string | unknown;
          code?: string;
        } = {};
        try {
          body = await response.json();
        } catch {
          // Non-JSON error body
        }
        const main = body.error || "An error occurred";
        const detail =
          typeof body.details === "string"
            ? body.details
            : body.details != null
              ? JSON.stringify(body.details)
              : "";
        const suffix = detail
          ? `: ${detail}`
          : body.code
            ? ` (${body.code})`
            : "";
        throw new ApiClientError(`${main}${suffix}`, response.status, body.code);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error("Network error");
    }
  }

  // GET request
  async get<T>(endpoint: string, options?: FetchOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: "GET" });
  }

  // POST request
  async post<T>(
    endpoint: string,
    data?: any,
    options?: FetchOptions,
  ): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: "POST", data });
  }

  // PUT request
  async put<T>(
    endpoint: string,
    data?: any,
    options?: FetchOptions,
  ): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: "PUT", data });
  }

  // PATCH request
  async patch<T>(
    endpoint: string,
    data?: any,
    options?: FetchOptions,
  ): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: "PATCH", data });
  }

  // DELETE request
  async delete<T>(endpoint: string, options?: FetchOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: "DELETE" });
  }
}

// Export singleton instance
export const apiClient = new ApiClient();

export type SignupApiResponse = {
  message: string;
  requiresEmailVerification?: boolean;
  user?: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
  };
};

// Specific API functions for common operations

// Auth
export const authAPI = {
  signup: (data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    role: string;
    phone?: string;
    dateOfBirth?: string;
    gender?: string;
    language?: string;
    location?: string;
    // Medical Profile fields
    concernedPerson?: string;
    accountFor?: string;
    childFirstName?: string;
    childLastName?: string;
    childDateOfBirth?: string;
    childServiceType?: string;
    medicalConditions?: string[];
    otherMedicalCondition?: string;
    currentMedications?: string[];
    otherMedication?: string;
    consultationMotifs?: string[];
    substanceUse?: string;
    previousTherapy?: boolean;
    previousTherapyDetails?: string;
    psychiatricHospitalization?: boolean;
    currentTreatment?: string;
    diagnosedConditions?: string[];
    primaryIssue?: string;
    secondaryIssues?: string[];
    issueDescription?: string;
    severity?: string;
    duration?: string;
    triggeringSituation?: string;
    symptoms?: string[];
    dailyLifeImpact?: string;
    sleepQuality?: string;
    appetiteChanges?: string;
    treatmentGoals?: string[];
    therapyApproach?: string[];
    concernsAboutTherapy?: string;
    availability?: string[];
    modality?: string;
    sessionFrequency?: string;
    notes?: string;
    emergencyContactName?: string;
    emergencyContactPhone?: string;
    emergencyContactEmail?: string;
    emergencyContactRelation?: string;
    preferredGender?: string;
    preferredAge?: string;
    languagePreference?: string;
    culturalConsiderations?: string;
    paymentMethod?: string;
    agreeToTerms: boolean;
    acceptPrivacyPolicy: boolean;
    // Professional fields
    professionalProfile?: {
      problematics?: string[];
      approaches?: string[];
      ageCategories?: string[];
      diagnosedConditions?: string[];
      skills?: string[];
      bio?: string;
      yearsOfExperience?: number;
      specialty?: string;
      license?: string;
      certifications?: string[];
      availability?: {
        days: {
          day: string;
          isWorkDay: boolean;
          startTime: string;
          endTime: string;
        }[];
        sessionDurationMinutes?: number;
        breakDurationMinutes?: number;
        firstDayOfWeek?: string;
      };
      clinicalAvailability?: string[];
      languages?: string[];
      sessionTypes?: string[];
      modalities?: string[];
      paymentAgreement?: string;
      paymentFrequency?: string;
      pricing?: {
        individualSession?: number;
        coupleSession?: number;
        groupSession?: number;
      };
      education?: {
        degree: string;
        institution: string;
        year?: number;
      }[];
    };
    provisionedByAdmin?: boolean;
  }) => apiClient.post<SignupApiResponse>("/auth/signup", data),
};

// Profile
export const profileAPI = {
  get: async () => {
    try {
      return await apiClient.get("/profile");
    } catch (error: any) {
      if (error.message === "Profile not found") {
        return null;
      }
      throw error;
    }
  },
  getById: (id: string) => apiClient.get(`/profile/${id}`),
  update: (data: any) => apiClient.put("/profile", data),
};

// Medical Profile
export const medicalProfileAPI = {
  get: () => apiClient.get("/medical-profile"),
  getByUserId: (userId: string) => apiClient.get(`/medical-profile/${userId}`),
  update: (data: any) => apiClient.put("/medical-profile", data),
};

// Appointments
export const appointmentsAPI = {
  list: (params?: {
    status?: string;
    startDate?: string;
    endDate?: string;
    clientId?: string;
    accountId?: string; // For guardian viewing managed account
  }) => {
    const query = new URLSearchParams(params as any).toString();
    return apiClient.get<AppointmentResponse[]>(
      `/appointments${query ? `?${query}` : ""}`,
    );
  },
  create: (data: any) =>
    apiClient.post<AppointmentResponse>("/appointments", data),
  get: (id: string) =>
    apiClient.get<AppointmentResponse>(`/appointments/${id}`),
  update: (id: string, data: any) =>
    apiClient.patch<AppointmentResponse>(`/appointments/${id}`, data),
  delete: (id: string) =>
    apiClient.delete<{ success: boolean }>(`/appointments/${id}`),
  completeSession: (
    id: string,
    data: {
      sessionActNature: string;
      sessionActNatureOther?: string;
      sessionOutcome: string;
      nextAppointmentDate?: string;
      nextAppointmentTime?: string;
    },
  ) =>
    apiClient.post<AppointmentResponse>(
      `/appointments/${id}/complete-session`,
      data,
    ),
};

export type ClientReceiptRecord = {
  _id: string;
  clientId: string;
  appointmentId: string;
  issuedAt: string;
  amountCad: number;
  status: "paid" | "pending_transfer";
};

export const clientReceiptsAPI = {
  list: () => apiClient.get<ClientReceiptRecord[]>("/client/receipts"),
};

export type ProfessionalLedgerEntryResponse = {
  _id: string;
  professionalId: string;
  entryKind?: "credit" | "debit";
  cycleKey?: string;
  appointmentId?: string;
  sessionActNature?: string;
  // grossAmountCad + platformFeeCad are stripped by the API for professional callers.
  netToProfessionalCad: number;
  paymentChannel: "stripe" | "transfer" | "none";
  payoutAmountCad?: number;
  payoutReference?: string;
  payoutNotes?: string;
  createdAt: string;
};

export const professionalLedgerAPI = {
  get: () =>
    apiClient.get<{
      entries: ProfessionalLedgerEntryResponse[];
      pendingPayoutCad: number;
      currentCycleKey?: string;
      balanceLifetimeCad?: number;
      balanceCurrentCycleCad?: number;
    }>("/professional/ledger-entries"),
};

// Users
export const usersAPI = {
  get: () => apiClient.get("/users/me"),
  getById: (id: string) => apiClient.get(`/users/${id}`),
  update: (data: any) => apiClient.patch("/users/me", data),
  updateById: (id: string, data: any) => apiClient.patch(`/users/${id}`, data),
  list: (params?: { role?: string }) => {
    const query = new URLSearchParams(params as any).toString();
    return apiClient.get(`/users${query ? `?${query}` : ""}`);
  },
};

// Clients
export const clientsAPI = {
  list: (params?: { status?: string; issueType?: string; search?: string }) => {
    const query = new URLSearchParams(params as any).toString();
    return apiClient.get(`/clients${query ? `?${query}` : ""}`);
  },
};
